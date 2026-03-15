/**
 * Claude CLI Messenger Implementation - Inter-role message formatting + LLM summarization capabilities
 * @module roles/messenger/claude-cli-messenger
 */

import { inject, injectable } from 'tsyringe';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
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
import {
  PROCESS_POOL_TOKEN,
  OUTPUT_PARSER_TOKEN,
  PROMPT_FRAMEWORK_TOKEN,
  CONFIG_TOKEN,
  LOGGER_TOKEN,
} from '../../tokens.js';
import type { CliProcessPool } from '../../infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from '../../infrastructure/cli-adapter/output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { WORKER_PHASE_PERMISSIONS, ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

/** Messenger LLM call's generic system prompt */
const MESSENGER_SYSTEM_PROMPT = `You are a professional content processing assistant. Your responsibility is to summarize, abstract, or structurally transform input content.
Rules:
1. Strictly output in the required format
2. Keep key information, remove redundancy
3. Do not add subjective evaluations or extra suggestions
4. Output must be in a machine-parseable format`;

@injectable()
export class ClaudeCliMessenger implements IMessenger {
  constructor(
    @inject(PROCESS_POOL_TOKEN) private processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) private outputParser: CliOutputParser,
    @inject(PROMPT_FRAMEWORK_TOKEN) private framework: IPromptFramework,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  /**
   * Build complete instructions for Worker
   * Includes: Agent prompt + shared rules + command prompt + knowledge base + user input
   */
  async formatForWorker(phase: Phase, context: PipelineContext): Promise<WorkerCommand> {
    // Get agent definition from framework
    const agent = await this.framework.getAgent(phase);
    const knowledge = await this.framework.getKnowledge(phase);

    // Assemble system prompt: role + rules + command + knowledge base
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
      sessionId: context.workerSessionId,
      resume: context.completedPhases.length > 0,
      maxTurns: this.config.worker.defaultMaxTurns,
      disallowedTools: permissions.disallowed,
      cwd: this.config.cli.projectDir,
      timeout: this.config.worker.defaultTimeout,
    };
  }

  /** Build evaluation input for Evaluator */
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

  /** [LLM] Summarize content into concise summary */
  async summarize(content: string, format: SummaryFormat): Promise<string> {
    // Fast path: content shorter than threshold, don't call LLM
    if (content.length < this.config.messenger.summarizeThreshold) {
      return content;
    }

    try {
      const result = await this.processPool.execute({
        prompt: `Please summarize the following content into ${format.style} format, keeping key information and removing redundant details:\n\n${content}\n\nOutput format requirement: ${format.template}`,
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
        maxTurns: this.config.messenger.maxTurns,
        outputFormat: 'json',
        cwd: this.config.cli.projectDir,
      });

      const parsed = this.outputParser.extractJson<{ summary: string }>(result);
      return parsed.summary;
    } catch (err) {
      this.logger.warn({ err }, 'Messenger summarize failed, falling back to raw');
      return this.config.messenger.fallbackToRaw ? content : '';
    }
  }

  /** [LLM] Convert unstructured text to structured JSON */
  async structurize(rawOutput: string, schema: OutputSchema): Promise<StructuredData> {
    const result = await this.processPool.execute({
      prompt: [
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
      disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
      maxTurns: this.config.messenger.maxTurns,
      outputFormat: 'json',
      cwd: this.config.cli.projectDir,
    });

    return this.outputParser.extractJson<StructuredData>(result);
  }

  /** [LLM] Synthesize multiple Evaluator feedback into unified revision suggestions */
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

    // Fast path: feedback content shorter than threshold, return directly
    if (rawFeedback.length < this.config.messenger.summarizeThreshold) {
      return rawFeedback;
    }

    try {
      const result = await this.processPool.execute({
        prompt: [
          'Please synthesize the following multiple evaluator feedback into a unified revision suggestion.',
          '1. Merge duplicate issues',
          '2. Sort by severity',
          '3. Provide clear revision guidance for each issue',
          '',
          'Evaluation feedback:',
          rawFeedback,
        ].join('\n'),
        systemPrompt: MESSENGER_SYSTEM_PROMPT,
        disallowedTools: ROLE_PERMISSIONS.messenger.disallowed,
        maxTurns: this.config.messenger.maxTurns,
        outputFormat: 'json',
        cwd: this.config.cli.projectDir,
      });

      const parsed = this.outputParser.extractJson<{ feedback: string }>(result);
      return parsed.feedback;
    } catch {
      return rawFeedback; // Fall back to raw feedback
    }
  }

  /** Update Pipeline context based on Conductor decision (pure logic, no LLM) */
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

    // revise: update feedback info and attempt count
    return {
      ...context,
      revisionFeedback: decision.feedback,
      phaseAttempts: {
        ...context.phaseAttempts,
        [context.currentPhase]: (context.phaseAttempts[context.currentPhase] ?? 0) + 1,
      },
    };
  }

  // ---- Private helper methods ----

  /** Build user prompt to send to Worker */
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
