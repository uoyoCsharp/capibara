/**
 * MVTT Quality Evaluator
 * @module implementations/mvtt/mvtt-quality-evaluator
 */

import type { EvaluationDimension } from '../../core/types/evaluation.types.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { MvttEvaluator } from './mvtt-evaluator.js';

export class MvttQualityEvaluator extends MvttEvaluator {
  protected readonly dimension: EvaluationDimension = 'quality';

  constructor(
    executor: ICommandExecutor,
    outputParser: MvttOutputParser,
    config: AutomationConfig,
    logger: Logger,
  ) {
    super(executor, outputParser, config, logger);
  }

  protected buildSystemPrompt(): string {
    return ``;
  }
}
