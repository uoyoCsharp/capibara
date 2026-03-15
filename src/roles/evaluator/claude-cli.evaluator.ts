/**
 * CLI Evaluator Base Class - Common logic for all evaluation dimensions
 * Subclasses only need to implement buildSystemPrompt() to provide dimension-specific prompts
 * @module roles/evaluator/claude-cli-evaluator
 */

import { inject } from 'tsyringe';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type {
  EvaluationInput,
  EvaluationResult,
  EvaluationDimension,
} from '../../core/types/evaluation.types.js';
import {
  PROCESS_POOL_TOKEN,
  OUTPUT_PARSER_TOKEN,
  CONFIG_TOKEN,
  LOGGER_TOKEN,
} from '../../tokens.js';
import type { CliProcessPool } from '../../infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from '../../infrastructure/cli-adapter/output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

/** Type guard for evaluation result JSON */
function isEvaluationOutput(data: unknown): data is Omit<EvaluationResult, 'dimension'> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'verdict' in data &&
    'score' in data &&
    'issues' in data
  );
}

export abstract class ClaudeCliEvaluator implements IEvaluator {
  protected abstract readonly dimension: EvaluationDimension;

  constructor(
    @inject(PROCESS_POOL_TOKEN) protected processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) protected outputParser: CliOutputParser,
    @inject(CONFIG_TOKEN) protected config: AutomationConfig,
    @inject(LOGGER_TOKEN) protected logger: Logger,
  ) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);
    const permissions = ROLE_PERMISSIONS.evaluator;

    this.logger.info({ dimension: this.dimension, phase: input.phase }, 'Evaluator starting');

    const result = await this.processPool.execute({
      prompt: userPrompt,
      systemPrompt,
      sessionId: `eval-${input.pipelineId}-${input.phase}-${this.dimension}`,
      disallowedTools: permissions.disallowed,
      maxTurns: this.config.evaluator.maxTurns,
      outputFormat: 'json',
      cwd: input.projectDir,
    });

    return this.parseResult(result, input);
  }

  getDimension(): EvaluationDimension {
    return this.dimension;
  }

  /** Subclass implementation: Build evaluation dimension's system prompt */
  protected abstract buildSystemPrompt(): string;

  /** Build user prompt to send to Evaluator */
  private buildUserPrompt(input: EvaluationInput): string {
    return [
      `## Project Summary\n${input.projectSummary}`,
      `## Current Phase: ${input.phase}\n${input.phaseSummary}`,
      `## Artifact to Evaluate\n${input.artifact}`,
      `## Evaluation Criteria\n${input.evaluationCriteria}`,
      'Please output evaluation result in JSON format as required in system prompt.',
    ].join('\n\n');
  }

  /** Retry parsing evaluation result multiple times */
  private parseResult(cliResult: any, input: EvaluationInput): EvaluationResult {
    const retries = this.config.evaluator.parseRetries;
    for (let i = 0; i <= retries; i++) {
      try {
        const parsed = this.outputParser.extractJson(cliResult, isEvaluationOutput);
        return { ...parsed, dimension: this.dimension };
      } catch {
        if (i === retries) {
          this.logger.warn(
            { dimension: this.dimension, phase: input.phase },
            'Evaluation parse failed after retries, returning fallback',
          );
          return this.fallbackResult();
        }
      }
    }
    return this.fallbackResult();
  }

  /** Fallback result when parsing fails */
  private fallbackResult(): EvaluationResult {
    return {
      dimension: this.dimension,
      verdict: 'needs_revision',
      score: 0,
      issues: [
        {
          severity: 'major',
          category: 'parse_error',
          description: 'Evaluation result parsing failed, requires manual review',
        },
      ],
      summary: 'Evaluation output format abnormal, cannot auto-parse',
    };
  }
}
