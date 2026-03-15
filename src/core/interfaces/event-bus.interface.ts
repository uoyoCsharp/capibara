/**
 * Event Bus Interface - Pub/Sub for Pipeline events
 * @module core/interfaces/event-bus
 */

import type { PipelineEvent, PipelineEventType } from '../types/events.types.js';

export interface IEventBus {
  /** Emit event (fire-and-forget) */
  emit(event: PipelineEvent): void;

  /** Subscribe to specified event type */
  on(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void;

  /** Unsubscribe */
  off(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void;
}
