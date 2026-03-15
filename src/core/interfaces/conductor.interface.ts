/**
 * Conductor Role Interface - Responsible for making routing decisions based on evaluation results
 * @module core/interfaces/conductor
 */

import type { EvaluationResult } from '../types/evaluation.types.js';
import type { ConductorDecision } from '../types/conductor.types.js';

export interface IConductor {
  /** Make comprehensive decision based on multi-dimensional evaluation results: approve / revise / escalate */
  decide(evaluations: EvaluationResult[]): Promise<ConductorDecision>;
}
