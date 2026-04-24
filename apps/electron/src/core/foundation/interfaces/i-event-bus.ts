import type { DomainEvent, DomainEventType } from '@core/foundation/events';

export type Unsubscribe = () => void;

export interface IEventBus {
  emit<T extends DomainEventType>(event: DomainEvent<T>): void;
  on<T extends DomainEventType>(eventType: T, handler: (event: DomainEvent<T>) => void): Unsubscribe;
  off<T extends DomainEventType>(eventType: T, handler: (event: DomainEvent<T>) => void): void;
}
