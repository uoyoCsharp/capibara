import type { DomainEventType, DomainEventMap } from '@core/foundation/events';

/**
 * Service-facing publisher. Writes an event to the durable outbox inside the
 * caller's transaction scope. A post-commit background drain emits it on
 * the in-memory EventBus for subscribers.
 *
 * Services MUST NOT import IEventBus — use IEventPublisher instead.
 */
export interface IEventPublisher {
  publish<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void;
}
