/**
 * MVTT Messenger Implementation - Central routing and synthesis hub
 *
 * Responsibilities:
 * - Format commands for Worker (via prompt framework)
 * - Route: determine if Worker output needs Evaluator assessment
 * - Synthesize: merge multiple Evaluator results into unified text
 * - Prepare: format content for Conductor decision-making
 * - Update context based on Conductor decisions (LLM-enhanced for revise path)
 *
 * @module implementations/mvtt/mvtt-messenger
 */

import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { MvttPromptFramework } from './mvtt-prompt-framework.js';
import type { Phase } from '../../core/types/phase.types.js';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../../core/types/worker.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { WORKER_PHASE_PERMISSIONS, ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

const MESSENGER_SYSTEM_PROMPT = `You are a professional content processing assistant. Your responsibility is to analyze, summarize, and transform content between roles in a software development pipeline.
Rules:
1. Be concise and precise
2. Preserve key information
3. Do not add subjective opinions beyond what is asked`;

export class MvttMessenger implements IMessenger {
  constructor(
    private executor: ICommandExecutor,
    private outputParser: MvttOutputParser,
    private framework: MvttPromptFramework,
    private config: AutomationConfig,
    private logger: Logger,
  ) {}

  async formatForWorker(phase: Phase, context: PipelineContext): Promise<WorkerCommand> {
    const agent = await this.framework.getAgent(phase);
    const knowledge = await this.framework.getKnowledge(phase);

    const systemPrompt = [
      agent.rolePrompt,
      agent.sharedRules,
      agent.commandPrompt,
      knowledge.patterns.join('\n\n---\n\n'),
      'Currently in automation mode, do not wait for user confirmation, execute directly. Do not output "suggested next steps".',
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    const input = this.buildUserPrompt(phase, context);
    const permissions = WORKER_PHASE_PERMISSIONS[phase];

    return {
      command: `#${phase}`,
      input,
      systemPrompt,
      executorOptions: {
        sessionId: context.workerSessionId,
        resume: context.completedPhases.length > 0,
        maxTurns: this.config.worker.defaultMaxTurns,
        disallowedTools: permissions.disallowed,
      },
      cwd: this.config.cli.projectDir,
      timeout: this.config.worker.defaultTimeout,
    };
  }

  async shouldEvaluate(workerResult: WorkerResult, context: PipelineContext): Promise<boolean> {
    const content = workerResult.artifact || workerResult.output;

    if (!workerResult.success) {
      this.logger.info(
        { phase: context.currentPhase },
        'Worker failed, skipping evaluation — sending to conductor directly',
      );
      return false;
    }

    try {
      const response = await this.executor.execute({
        input: [
          `Analyze the following artifact from the "${context.currentPhase}" phase.`,
          'Determine if it contains any issues, errors, risks, or areas that need expert evaluation.',
          '',
          'Artifact:',
          content,
          '',
          'Respond with JSON: {"needsEvaluation": true/false, "reason": "brief explanation"}',
        ].join('\n'),
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        cwd: this.config.cli.projectDir,
        options: {
          disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
          maxTurns: this.config.messenger.maxTurns,
          outputFormat: 'json',
        },
      });

      const parsed = this.outputParser.extractJson<{ needsEvaluation: boolean }>(response);
      this.logger.info(
        { phase: context.currentPhase, needsEvaluation: parsed.needsEvaluation },
        'shouldEvaluate result',
      );
      return parsed.needsEvaluation;
    } catch (err) {
      this.logger.warn({ err }, 'shouldEvaluate LLM call failed, defaulting to true');
      return true;
    }
  }

  async synthesize(evaluatorResults: string[], context: PipelineContext): Promise<string> {
    if (evaluatorResults.length === 0) {
      return '';
    }

    if (evaluatorResults.length === 1) {
      return evaluatorResults[0];
    }

    try {
      const response = await this.executor.execute({
        input: [
          'Synthesize the following evaluator assessments into a single unified evaluation.',
          'Merge duplicate issues, highlight the most critical findings, and provide a coherent summary.',
          '',
          ...evaluatorResults.map((r, i) => `--- Evaluator ${i + 1} ---\n${r}`),
        ].join('\n'),
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        cwd: this.config.cli.projectDir,
        options: {
          disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
          maxTurns: this.config.messenger.maxTurns,
        },
      });

      return response.output;
    } catch (err) {
      this.logger.warn({ err }, 'synthesize failed, concatenating raw results');
      return evaluatorResults.join('\n\n---\n\n');
    }
  }

  async prepareForConductor(content: string, context: PipelineContext): Promise<string> {
    const header = [
      `Phase: ${context.currentPhase}`,
      `Attempt: ${context.phaseAttempts[context.currentPhase] ?? 0}`,
      `Pipeline: ${context.pipelineId}`,
    ].join(' | ');

    return `${header}\n\n${content}`;
  }

  async updateContext(
    decision: ConductorDecision,
    context: PipelineContext,
  ): Promise<PipelineContext> {
    if (decision.action === 'approve') {
      const phases = this.framework.getSupportedPhases().map((p) => p.id);
      const currentIdx = phases.indexOf(context.currentPhase);
      const nextPhase = phases[currentIdx + 1];
      return {
        ...context,
        completedPhases: [...context.completedPhases, context.currentPhase],
        currentPhase: nextPhase ?? context.currentPhase,
        revisionFeedback: undefined,
      };
    }

    const enhancedFeedback = await this.enhanceFeedback(decision.feedback, context);
    return {
      ...context,
      revisionFeedback: enhancedFeedback,
    };
  }

  private async enhanceFeedback(
    rawFeedback: string[] | undefined,
    context: PipelineContext,
  ): Promise<string[]> {
    if (!rawFeedback || rawFeedback.length === 0) {
      return [];
    }

    try {
      const response = await this.executor.execute({
        input: [
          `You are processing revision feedback for the "${context.currentPhase}" phase of a software development pipeline.`,
          '',
          'Original feedback from the Conductor:',
          rawFeedback.map((f, i) => `${i + 1}. ${f}`).join('\n'),
          '',
          'Context:',
          `- Phase: ${context.currentPhase}`,
          `- Attempt: ${context.phaseAttempts[context.currentPhase] ?? 0}`,
          `- Previous revision feedback: ${context.revisionFeedback ? context.revisionFeedback.join('; ') : '(none)'}`,
          `- Requirement: ${context.requirement.description}`,
          '',
          'Transform this feedback into clear, actionable revision instructions:',
          '1. Make each instruction specific and executable',
          '2. Add relevant context from the requirement and phase',
          '3. Remove vague or redundant items',
          '4. If previous revision feedback exists, reconcile with new feedback (avoid contradictions)',
          '5. Order by priority (most critical first)',
          '',
          'Output JSON: {"instructions": ["instruction 1", "instruction 2", ...]}',
        ].join('\n'),
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        cwd: this.config.cli.projectDir,
        options: {
          disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
          maxTurns: this.config.messenger.maxTurns,
          outputFormat: 'json',
        },
      });

      const parsed = this.outputParser.extractJson<{ instructions: string[] }>(response);
      this.logger.info(
        { phase: context.currentPhase, instructionCount: parsed.instructions.length },
        'Enhanced revision feedback',
      );
      return parsed.instructions;
    } catch (err) {
      this.logger.warn({ err }, 'enhanceFeedback LLM call failed, using raw feedback');
      return rawFeedback;
    }
  }

  private buildUserPrompt(phase: Phase, context: PipelineContext): string {
    const parts: string[] = [`#${phase} ${context.requirement.description}`];
    if (context.revisionFeedback?.length) {
      parts.push(`\n\n## Revision Requirements\n${context.revisionFeedback.join('\n')}`);
    }
    return parts.join('');
  }
}
