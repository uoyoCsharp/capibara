/**
 * Human Interaction Strategy Interface
 * @module application/human-interaction/strategies
 */

import type { Phase, InteractionMode } from '../../../core/types/phase.types.js';
import type { InteractionRecord } from '../../../core/types/pipeline.types.js';
import type { HumanResponse } from '../human-interaction.handler.js';

export interface InterventionContext {
  pipelineId: string;
  changeId: string;
  phase: Phase;
  round: number;
  mode: InteractionMode;
  /** Last 3 interaction records */
  recentInteractions: InteractionRecord[];
  /** Current worker output (full) */
  currentOutput: string;
  /** Evaluator results (if evaluated) */
  evaluatorResults?: string[];
  /** Conductor escalate reason (for semi-auto mode) */
  escalateReason?: string;
}

export interface IHumanInteractionStrategy {
  /** Request human approval with full context */
  requestApproval(context: InterventionContext): Promise<HumanResponse>;
}
