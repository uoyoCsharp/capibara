import Emittery from 'emittery';
import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent, DomainEventType } from '@core/foundation/events';

@injectable()
export class EmitteryEventBus implements IEventBus {
  private readonly emitter = new Emittery();

  emit<T>(event: DomainEvent<T>): void {
    this.emitter.emit(event.type, event).catch((err) => {
      console.error(`[EventBus] Unhandled error in handler for '${event.type}':`, err);
    });
  }

  on<T>(eventType: DomainEventType, handler: (event: DomainEvent<T>) => void): void {
    this.emitter.on(eventType, handler as (data: unknown) => void);
  }

  off<T>(eventType: DomainEventType, handler: (event: DomainEvent<T>) => void): void {
    this.emitter.off(eventType, handler as (data: unknown) => void);
  }
}
