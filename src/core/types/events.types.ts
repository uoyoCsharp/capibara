/**
 * Pipeline event system type definitions
 * @module core/types/events
 */

import type { Phase } from './phase.types.js';

export type PipelineEventType =
  | 'pipeline:started'
  | 'pipeline:completed'
  | 'pipeline:failed'
  | 'phase:started'
  | 'phase:completed'
  | 'phase:retry'
  | 'worker:started'
  | 'worker:completed'
  | 'evaluator:started'
  | 'evaluator:completed'
  | 'conductor:decided'
  | 'messenger:summarized'
  | 'human:intervention_requested'
  | 'human:response_received'
  | 'cost:threshold_warning'
  | 'orchestrator:started'
  | 'orchestrator:stopped';

export interface PipelineEvent {
  timestamp: string;
  pipelineId: string;
  phase?: Phase;
  role?: string;
  eventType: PipelineEventType;
  data: Record<string, unknown>;
}
