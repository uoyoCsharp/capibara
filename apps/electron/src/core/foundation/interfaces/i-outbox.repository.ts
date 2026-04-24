import type { DomainEventType, DomainEventMap } from '@core/foundation/events';

export interface OutboxRow<T extends DomainEventType = DomainEventType> {
  id: string;
  eventType: T;
  payload: DomainEventMap[T];
  createdAt: string;
}

export interface IOutboxRepository {
  enqueue<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): string;
  findUnpublished(limit: number): OutboxRow[];
  markPublished(ids: string[]): void;
}
