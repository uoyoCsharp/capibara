/**
 * Evaluator Role Interface - Evaluates Worker artifacts and returns plain text assessment
 * @module core/interfaces/evaluator
 */

import type { EvaluationContext } from '../types/evaluation.types.js';

export interface IEvaluator {
  /** Evaluate artifact, return plain text evaluation result */
  evaluate(artifact: string, context: EvaluationContext): Promise<string>;
}
