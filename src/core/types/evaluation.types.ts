/**
 * Evaluation related type definitions
 * @module core/types/evaluation
 */

import type { Phase } from './phase.types.js';

/** Minimal context needed by Evaluator to perform evaluation */
export interface EvaluationContext {
  pipelineId: string;
  phase: Phase;
  projectDir: string;
}
