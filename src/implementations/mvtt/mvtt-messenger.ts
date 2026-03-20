/**
 * MVTT Messenger Implementation - Inter-role message formatting + LLM summarization
 *
 * Thin layer: assembles prompts via IPromptFramework, delegates LLM calls to ICommandExecutor.
 * @module implementations/mvtt/mvtt-messenger
 */

import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { IPromptFramework } from '../../core/interfaces/prompt-framework.interface.js';
import type { Phase } from '../../core/types/phase.types.js';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../../core/types/worker.types.js';
import type { EvaluationInput, EvaluationResult } from '../../core/types/evaluation.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import type {
  SummaryFormat,
  StructuredData,
  OutputSchema,
} from '../../core/types/messenger.types.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { WORKER_PHASE_PERMISSIONS, ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

const MESSENGER_SYSTEM_PROMPT = `You are a professional content processing assistant. Your responsibility is to summarize, abstract, or structurally transform input content.
Rules:
1. Strictly output in the required format
2. Keep key information, remove redundancy
3. Do not add subjective evaluations or extra suggestions
4. Output must be in a machine-parseable format`;

export class MvttMessenger implements IMessenger {
  constructor(
    private executor: ICommandExecutor,
    private outputParser: MvttOutputParser,
    private framework: IPromptFramework,
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

  async formatForEvaluator(workerOutput: WorkerResult, context: PipelineContext): Promise<EvaluationInput> {
    const criteria = await this.framework.getEvaluationCriteria(context.currentPhase);

    return {
      projectSummary: this.extractProjectSummary(context),
      phaseSummary: this.extractPhaseSummary(context),
      artifact: workerOutput.artifact || workerOutput.output,
      evaluationCriteria: criteria.rawContent ?? criteria.items.map(i => i.description).join('\n'),
      pipelineId: context.pipelineId,
      phase: context.currentPhase,
      projectDir: this.config.cli.projectDir,
    };
  }

  async summarize(content: string, format: SummaryFormat): Promise<string> {
    if (content.length < this.config.messenger.summarizeThreshold) {
      return content;
    }

    try {
      const response = await this.executor.execute({
        input: `Please summarize the following content into ${format.style} format, keeping key information and removing redundant details:\n\n${content}\n\nOutput format requirement: ${format.template}`,
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        cwd: this.config.cli.projectDir,
        options: {
          disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
          maxTurns: this.config.messenger.maxTurns,
          outputFormat: 'json',
        },
      });

      const parsed = this.outputParser.extractJson<{ summary: string }>(response);
      return parsed.summary;
    } catch (err) {
      this.logger.warn({ err }, 'Messenger summarize failed, falling back to raw');
      return this.config.messenger.fallbackToRaw ? content : '';
    }
  }

  async structurize(rawOutput: string, schema: OutputSchema): Promise<StructuredData> {
    const response = await this.executor.execute({
      input: [
        'Please convert the following content to the specified JSON format.',
        '',
        'Original content:',
        rawOutput,
        '',
        'Target JSON Schema:',
        JSON.stringify(schema),
        '',
        'Please strictly output JSON according to Schema, do not include extra text.',
      ].join('\n'),
      systemPrompt: MESSENGER_SYSTEM_PROMPT,
      cwd: this.config.cli.projectDir,
      options: {
        disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
        maxTurns: this.config.messenger.maxTurns,
        outputFormat: 'json',
      },
    });

    return this.outputParser.extractJson<StructuredData>(response);
  }

  async synthesizeFeedback(
    evaluations: EvaluationResult[],
    context: PipelineContext,
  ): Promise<string> {
    const rawFeedback = evaluations
      .map(
        (e) =>
          `[${e.dimension} evaluation - ${e.verdict}]\n${e.issues
            .map(
              (i) =>
                `- [${i.severity}] ${i.category}: ${i.description}${i.suggestion ? ` -> ${i.suggestion}` : ''}`,
            )
            .join('\n')}`,
      )
      .join('\n\n');

    if (rawFeedback.length < this.config.messenger.summarizeThreshold) {
      return rawFeedback;
    }

    try {
      const response = await this.executor.execute({
        input: [
          'Please synthesize the following multiple evaluator feedback into a unified revision suggestion.',
          '1. Merge duplicate issues',
          '2. Sort by severity',
          '3. Provide clear revision guidance for each issue',
          '',
          'Evaluation feedback:',
          rawFeedback,
        ].join('\n'),
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        cwd: this.config.cli.projectDir,
        options: {
          disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
          maxTurns: this.config.messenger.maxTurns,
          outputFormat: 'json',
        },
      });

      const parsed = this.outputParser.extractJson<{ feedback: string }>(response);
      return parsed.feedback;
    } catch {
      return rawFeedback;
    }
  }

  updateContext(decision: ConductorDecision, context: PipelineContext): PipelineContext {
    if (decision.action === 'approve') {
      const phases = this.framework.getSupportedPhases().map(p => p.id);
      const currentIdx = phases.indexOf(context.currentPhase);
      const nextPhase = phases[currentIdx + 1];
      return {
        ...context,
        completedPhases: [...context.completedPhases, context.currentPhase],
        currentPhase: nextPhase ?? context.currentPhase,
        revisionFeedback: undefined,
      };
    }

    return {
      ...context,
      revisionFeedback: decision.feedback,
      phaseAttempts: {
        ...context.phaseAttempts,
        [context.currentPhase]: (context.phaseAttempts[context.currentPhase] ?? 0) + 1,
      },
    };
  }

  private buildUserPrompt(phase: Phase, context: PipelineContext): string {
    const parts: string[] = [`#${phase} ${context.requirement.description}`];
    if (context.revisionFeedback?.length) {
      parts.push(`\n\n## Revision Requirements\n${context.revisionFeedback.join('\n')}`);
    }
    return parts.join('');
  }

  private extractProjectSummary(context: PipelineContext): string {
    return `Project: ${context.requirement.title}\nRequirement: ${context.requirement.description}`;
  }

  private extractPhaseSummary(context: PipelineContext): string {
    return `Phase: ${context.currentPhase}, Attempt count: ${context.phaseAttempts[context.currentPhase] ?? 0}`;
  }
}
