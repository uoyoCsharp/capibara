import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OutboxEventPublisher } from '@core/infrastructure/observability/outbox.publisher';
import type { IOutboxRepository, OutboxRow } from '@core/foundation/interfaces/i-outbox.repository';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEventType, DomainEventMap } from '@core/foundation/events';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';

class InMemoryOutboxRepository implements IOutboxRepository {
  private rows: OutboxRow[] = [];
  private published = new Set<string>();
  private counter = 0;

  enqueue<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): string {
    const id = `outbox-${++this.counter}`;
    this.rows.push({
      id,
      eventType: type,
      payload: payload as DomainEventMap[DomainEventType],
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  findUnpublished(limit: number): OutboxRow[] {
    return this.rows.filter((r) => !this.published.has(r.id)).slice(0, limit);
  }

  markPublished(ids: string[]): void {
    for (const id of ids) this.published.add(id);
  }

  totalRows(): number {
    return this.rows.length;
  }

  publishedCount(): number {
    return this.published.size;
  }
}

describe('OutboxEventPublisher', () => {
  let outbox: InMemoryOutboxRepository;
  let bus: MockEventBus;
  let publisher: OutboxEventPublisher;

  beforeEach(() => {
    outbox = new InMemoryOutboxRepository();
    bus = new MockEventBus();
    publisher = new OutboxEventPublisher(outbox, bus, new MockLogger());
  });

  it('publish() enqueues immediately, bus dispatch happens in microtask', async () => {
    publisher.publish('org:created', { orgId: 'o1', name: 'Acme' });

    // Row is already in outbox, but bus hasn't dispatched yet (microtask queued)
    expect(outbox.totalRows()).toBe(1);
    expect(bus.getEmitted()).toHaveLength(0);

    await Promise.resolve(); // drain microtasks

    expect(bus.getEmitted()).toHaveLength(1);
    expect(bus.getEmitted()[0]).toMatchObject({ type: 'org:created', payload: { orgId: 'o1', name: 'Acme' } });
    expect(outbox.publishedCount()).toBe(1);
  });

  it('batches multiple publishes into a single drain', async () => {
    publisher.publish('task:created', { taskId: 't1', orgId: 'o1', type: 'task', parentId: null });
    publisher.publish('task:created', { taskId: 't2', orgId: 'o1', type: 'task', parentId: null });
    publisher.publish('task:created', { taskId: 't3', orgId: 'o1', type: 'task', parentId: null });

    expect(bus.getEmitted()).toHaveLength(0);

    await Promise.resolve();

    expect(bus.getEmitted()).toHaveLength(3);
    expect(outbox.publishedCount()).toBe(3);
  });

  it('start() drains existing unpublished rows on startup', async () => {
    outbox.enqueue('org:created', { orgId: 'o-pre', name: 'Preloaded' });
    expect(bus.getEmitted()).toHaveLength(0);

    publisher.start();
    await Promise.resolve();

    expect(bus.getEmitted()).toHaveLength(1);
    expect(bus.getEmitted()[0].payload).toMatchObject({ orgId: 'o-pre' });
  });

  it('does not double-publish a row that was already marked published', async () => {
    publisher.publish('role:deleted', { roleId: 'r1', orgId: 'o1' });
    await Promise.resolve();

    // Trigger another drain; should emit nothing new
    const spy = vi.spyOn(bus, 'emit');
    publisher.publish('role:deleted', { roleId: 'r2', orgId: 'o1' });
    await Promise.resolve();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
