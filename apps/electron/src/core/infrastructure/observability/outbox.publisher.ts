import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { IOutboxRepository } from '@core/foundation/interfaces/i-outbox.repository';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventType, DomainEventMap } from '@core/foundation/events';

const BATCH_SIZE = 100;

/**
 * Transactional outbox publisher.
 *
 * Services call `publish()`, which synchronously inserts into the `outbox`
 * table (participating in any enclosing DB transaction). A drain is
 * scheduled via `queueMicrotask`, so if the enclosing transaction rolls
 * back the outbox row vanishes and no subscriber ever sees the event.
 * On commit, the microtask runs: unpublished rows are fanned out through
 * the in-memory EventBus to subscribers, then marked published.
 */
@injectable()
export class OutboxEventPublisher implements IEventPublisher {
  private drainScheduled = false;
  private started = false;

  constructor(
    private readonly outbox: IOutboxRepository,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleDrain();
    this.logger.info('OutboxEventPublisher started');
  }

  publish<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.outbox.enqueue(type, payload);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      try {
        this.drainOnce();
      } catch (err) {
        this.logger.error('Outbox drain failed', { error: String(err) });
      }
    });
  }

  private drainOnce(): void {
    let rows = this.outbox.findUnpublished(BATCH_SIZE);
    while (rows.length > 0) {
      for (const row of rows) {
        this.eventBus.emit({
          type: row.eventType,
          timestamp: row.createdAt,
          payload: row.payload,
        });
      }
      this.outbox.markPublished(rows.map((r) => r.id));
      rows = this.outbox.findUnpublished(BATCH_SIZE);
    }
  }
}
