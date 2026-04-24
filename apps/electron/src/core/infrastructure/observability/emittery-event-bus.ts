import Emittery from 'emittery';
import { injectable } from 'tsyringe';
import type { IEventBus, Unsubscribe } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent, DomainEventType } from '@core/foundation/events';

@injectable()
export class EmitteryEventBus implements IEventBus {
  private readonly emitter = new Emittery();

  emit<T extends DomainEventType>(event: DomainEvent<T>): void {
    this.emitter.emit(event.type, event).catch((err) => {
      console.error(`[EventBus] Unhandled error in handler for '${event.type}':`, err);
    });
  }

  on<T extends DomainEventType>(
    eventType: T,
    handler: (event: DomainEvent<T>) => void,
  ): Unsubscribe {
    const wrapped = handler as (data: unknown) => void;
    this.emitter.on(eventType, wrapped);
    return () => this.emitter.off(eventType, wrapped);
  }

  off<T extends DomainEventType>(
    eventType: T,
    handler: (event: DomainEvent<T>) => void,
  ): void {
    this.emitter.off(eventType, handler as (data: unknown) => void);
  }
}
