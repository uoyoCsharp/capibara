/**
 * MVTT Evaluator Base Class
 *
 * Thin layer: assembles evaluation prompt -> delegates to ICommandExecutor -> parses result.
 * Subclasses only need to implement buildSystemPrompt() for dimension-specific instructions.
 * @module implementations/mvtt/mvtt-evaluator
 */

import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type {
  EvaluationInput,
  EvaluationResult,
  EvaluationDimension,
} from '../../core/types/evaluation.types.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

export abstract class MvttEvaluator implements IEvaluator {
  protected abstract readonly dimension: EvaluationDimension;

  constructor(
    protected executor: ICommandExecutor,
    protected outputParser: MvttOutputParser,
    protected config: AutomationConfig,
    protected logger: Logger,
  ) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);
    const permissions = ROLE_PERMISSIONS.evaluator;

    this.logger.info({ dimension: this.dimension, phase: input.phase }, 'MvttEvaluator starting');

    const response = await this.executor.execute({
      input: userPrompt,
      systemPrompt,
      cwd: input.projectDir,
      timeout: this.config.worker.defaultTimeout,
      options: {
        disallowedTools: permissions.disallowed,
        maxTurns: this.config.evaluator.maxTurns,
        outputFormat: 'json',
      },
    });

    return this.parseResult(response);
  }

  getDimension(): EvaluationDimension {
    return this.dimension;
  }

  protected abstract buildSystemPrompt(): string;

  private buildUserPrompt(input: EvaluationInput): string {
    return [
      `## Project Summary\n${input.projectSummary}`,
      `## Current Phase: ${input.phase}\n${input.phaseSummary}`,
      `## Artifact to Evaluate\n${input.artifact}`,
      `## Evaluation Criteria\n${input.evaluationCriteria}`,
      'Please output evaluation result in JSON format as required in system prompt.',
    ].join('\n\n');
  }

  private parseResult(response: import('../../core/types/command-executor.types.js').CommandResponse): EvaluationResult {
    return this.outputParser.parseEvaluationResult(response, this.dimension);
  }
}
