/**
 * Evaluation result parsing related errors
 * @module core/errors/evaluation
 */

import { AppError } from './base.error.js';

/** Evaluation output format cannot be parsed */
export class EvaluationParseError extends AppError {
  constructor(dimension: string, detail: string) {
    super(`Evaluation parse error [${dimension}]: ${detail}`, 'EVAL_PARSE_ERROR', true);
  }
}
