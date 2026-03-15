/**
 * Core errors barrel export
 * @module core/errors
 */

export { AppError } from './base.error.js';
export { CliExecutionError, CliTimeoutError, CliParseError } from './cli.errors.js';
export { BudgetExceededError, PhaseError, PipelineError } from './pipeline.errors.js';
export { EvaluationParseError } from './evaluation.errors.js';
