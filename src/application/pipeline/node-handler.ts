/**
 * Node Handler Interface + event helper
 *
 * Strategy interface for pipeline node execution.
 * Each PipelineNodeType gets its own handler implementation.
 * @module application/pipeline/node-handler
 */

import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { PipelineNodeType, PipelineNodeDefinition } from '../../core/types/dag.types.js';
import type { PipelineContext, PhaseResult } from '../../core/types/pipeline.types.js';
import type { PipelineEventType } from '../../core/types/events.types.js';
import type { Phase } from '../../core/types/phase.types.js';
import type { GenericStateMachine } from '../state-machine/generic-state-machine.js';

export interface INodeHandler {
  readonly nodeType: PipelineNodeType;

  handle(
    node: PipelineNodeDefinition,
    context: PipelineContext,
    stateMachine: GenericStateMachine,
  ): Promise<PhaseResult>;
}

/** Reduce event emission boilerplate in handlers */
export function emitNodeEvent(
  eventBus: IEventBus,
  pipelineId: string,
  phase: Phase,
  eventType: PipelineEventType,
  data: Record<string, unknown>,
  role?: string,
): void {
  eventBus.emit({
    timestamp: new Date().toISOString(),
    pipelineId,
    phase,
    ...(role && { role }),
    eventType,
    data,
  });
}
