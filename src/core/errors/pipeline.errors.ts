/**
 * Pipeline orchestration related errors
 * @module core/errors/pipeline
 */

import { AppError } from './base.error.js';

/** Budget exceeded, Pipeline must terminate */
export class BudgetExceededError extends AppError {
  constructor(limit: number) {
    super(`Budget exceeded: limit $${limit}`, 'BUDGET_EXCEEDED', false);
  }
}

/** Single phase execution failed */
export class PhaseError extends AppError {
  constructor(phase: string, detail: string) {
    super(`Phase "${phase}" failed: ${detail}`, 'PHASE_ERROR', true);
  }
}

/** Pipeline-level generic error */
export class PipelineError extends AppError {
  constructor(detail: string) {
    super(`Pipeline error: ${detail}`, 'PIPELINE_ERROR', false);
  }
}
