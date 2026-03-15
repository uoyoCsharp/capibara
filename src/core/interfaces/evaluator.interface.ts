/**
 * Evaluator Role Interface - Responsible for evaluating Worker artifacts
 * @module core/interfaces/evaluator
 */

import type {
  EvaluationInput,
  EvaluationResult,
  EvaluationDimension,
} from '../types/evaluation.types.js';

export interface IEvaluator {
  /** Execute evaluation, return evaluation result for this dimension */
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;

  /** Return the dimension this evaluator is responsible for (quality / security / consistency) */
  getDimension(): EvaluationDimension;
}
