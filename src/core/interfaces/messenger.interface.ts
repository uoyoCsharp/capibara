/**
 * Messenger Role Interface - Responsible for message formatting, summarization, and structural conversion between roles
 * @module core/interfaces/messenger
 */

import type { Phase } from '../types/phase.types.js';
import type { PipelineContext } from '../types/pipeline.types.js';
import type { WorkerCommand, WorkerResult } from '../types/worker.types.js';
import type { EvaluationInput, EvaluationResult } from '../types/evaluation.types.js';
import type { ConductorDecision } from '../types/conductor.types.js';
import type { SummaryFormat, StructuredData, OutputSchema } from '../types/messenger.types.js';

export interface IMessenger {
  /** Build command for Worker using prompt framework */
  formatForWorker(phase: Phase, context: PipelineContext): Promise<WorkerCommand>;

  /** Build evaluation input for Evaluator */
  formatForEvaluator(workerOutput: WorkerResult, context: PipelineContext): Promise<EvaluationInput>;

  /** [LLM] Summarize content into concise summary */
  summarize(content: string, format: SummaryFormat): Promise<string>;

  /** [LLM] Convert unstructured text to structured JSON */
  structurize(rawOutput: string, schema: OutputSchema): Promise<StructuredData>;

  /** [LLM] Synthesize multiple Evaluator feedback into unified revision suggestions */
  synthesizeFeedback(evaluations: EvaluationResult[], context: PipelineContext): Promise<string>;

  /** Update context based on Conductor decision (pure logic, no LLM needed) */
  updateContext(decision: ConductorDecision, context: PipelineContext): PipelineContext;
}
