import type { IEventBus, Unsubscribe } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { DomainEvent, DomainEventType, DomainEventMap } from '@core/foundation/events';

/**
 * Test double that satisfies BOTH IEventBus and IEventPublisher.
 *
 * `publish()` (publisher) and `emit()` (bus) share the same synchronous
 * dispatch — tests don't need an outbox roundtrip.
 */
export class MockEventBus implements IEventBus, IEventPublisher {
  private handlers = new Map<DomainEventType, Array<(event: DomainEvent) => void>>();
  private emitted: DomainEvent[] = [];

  emit<T extends DomainEventType>(event: DomainEvent<T>): void {
    this.emitted.push(event as DomainEvent);
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      handler(event as DomainEvent);
    }
  }

  on<T extends DomainEventType>(
    eventType: T,
    handler: (event: DomainEvent<T>) => void,
  ): Unsubscribe {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler as (event: DomainEvent) => void);
    this.handlers.set(eventType, existing);
    return () => this.off(eventType, handler);
  }

  off<T extends DomainEventType>(
    eventType: T,
    handler: (event: DomainEvent<T>) => void,
  ): void {
    const existing = this.handlers.get(eventType) ?? [];
    const index = existing.indexOf(handler as (event: DomainEvent) => void);
    if (index >= 0) existing.splice(index, 1);
  }

  publish<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.emit({ type, timestamp: new Date().toISOString(), payload });
  }

  getEmitted(type?: DomainEventType): DomainEvent[] {
    if (!type) return this.emitted;
    return this.emitted.filter((e) => e.type === type);
  }

  getLastEmitted(type: DomainEventType): DomainEvent | undefined {
    const events = this.getEmitted(type);
    return events[events.length - 1];
  }

  assertEmitted(type: DomainEventType, count?: number): void {
    const events = this.getEmitted(type);
    if (count !== undefined && events.length !== count) {
      throw new Error(`Expected ${count} '${type}' events, got ${events.length}`);
    }
    if (events.length === 0) {
      throw new Error(`Expected '${type}' event to be emitted`);
    }
  }

  assertNotEmitted(type: DomainEventType): void {
    const events = this.getEmitted(type);
    if (events.length > 0) {
      throw new Error(`Expected '${type}' event NOT to be emitted, but got ${events.length}`);
    }
  }

  assertOrder(types: DomainEventType[]): void {
    const filtered = this.emitted.filter((e) => types.includes(e.type));
    const actual = filtered.map((e) => e.type);
    for (let i = 0; i < types.length; i++) {
      if (actual[i] !== types[i]) {
        throw new Error(`Event order mismatch at index ${i}: expected '${types[i]}', got '${actual[i] ?? 'none'}'`);
      }
    }
  }

  clear(): void {
    this.emitted = [];
  }
}
