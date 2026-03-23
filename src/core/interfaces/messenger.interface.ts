/**
 * Messenger Role Interface - Central routing and synthesis hub between roles
 * @module core/interfaces/messenger
 */

import type { Phase } from '../types/phase.types.js';
import type { PipelineContext } from '../types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../types/worker.types.js';
import type { ConductorDecision } from '../types/conductor.types.js';

export interface IMessenger {
  /** Build command for Worker using prompt framework */
  formatForWorker(phase: Phase, context: PipelineContext): Promise<WorkerCommand>;

  /** Determine whether Worker result needs Evaluator assessment */
  shouldEvaluate(workerResult: WorkerResult, context: PipelineContext): Promise<boolean>;

  /** Synthesize multiple Evaluator plain text results into unified text */
  synthesize(evaluatorResults: string[], context: PipelineContext): Promise<string>;

  /** Format content (from Worker directly or synthesized Evaluator results) for Conductor input */
  prepareForConductor(content: string, context: PipelineContext): Promise<string>;

  /** Update context based on Conductor decision */
  updateContext(decision: ConductorDecision, context: PipelineContext): Promise<PipelineContext>;
}
