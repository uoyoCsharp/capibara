import type { DomainEvent, DomainEventType } from '../types/event.types.js';

export interface IEventBus {
  emit<T>(event: DomainEvent<T>): void;
  on<T>(eventType: DomainEventType, handler: (event: DomainEvent<T>) => void): void;
  off<T>(eventType: DomainEventType, handler: (event: DomainEvent<T>) => void): void;
}
