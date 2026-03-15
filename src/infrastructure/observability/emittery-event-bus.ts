/**
 * Emittery Event Bus - Implementation of IEventBus
 * @module infrastructure/observability/emittery-event-bus
 */

import { injectable } from 'tsyringe';
import Emittery from 'emittery';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { PipelineEvent, PipelineEventType } from '../../core/types/events.types.js';

@injectable()
export class EmitteryEventBus implements IEventBus {
  private emitter = new Emittery<Record<PipelineEventType, PipelineEvent>>();

  /** Emit event (fire-and-forget, non-blocking to main flow) */
  emit(event: PipelineEvent): void {
    void this.emitter.emit(event.eventType, event);
  }

  on(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void {
    this.emitter.on(eventType, handler);
  }

  off(eventType: PipelineEventType, handler: (event: PipelineEvent) => void): void {
    this.emitter.off(eventType, handler);
  }
}
