import { injectable, inject } from 'tsyringe';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent, DomainEventType } from '@main/core/types/event.types.js';
import { EVENT_BUS_TOKEN, LOGGER_TOKEN } from '@main/core/tokens.js';

/**
 * Aggregates high-frequency domain events into batched digests
 * before forwarding to the Renderer via IPC.
 * See Architecture §10.3 — Event Digester (IPC Batching).
 */
@injectable()
export class EventDigester {
  private buffer: DomainEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback: ((events: DomainEvent[]) => void) | null = null;
  private windowMs: number;

  constructor(
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    this.windowMs = 300; // default aggregation window
  }

  start(
    eventTypes: DomainEventType[],
    flushCallback: (events: DomainEvent[]) => void,
    windowMs?: number,
  ): void {
    this.flushCallback = flushCallback;
    if (windowMs !== undefined) this.windowMs = windowMs;

    for (const eventType of eventTypes) {
      this.eventBus.on(eventType, (event: DomainEvent) => {
        this.buffer.push(event);
        this.scheduleFlush();
      });
    }

    this.logger.info('EventDigester started', {
      eventTypes: eventTypes.length,
      windowMs: this.windowMs,
    });
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.flush();
    }, this.windowMs);
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    this.logger.debug('EventDigester flushing', { count: events.length });
    this.flushCallback?.(events);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
