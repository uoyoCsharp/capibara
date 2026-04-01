import { injectable, inject } from 'tsyringe';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent, DomainEventType } from '@main/core/types/event.types.js';
import { EVENT_BUS_TOKEN, LOGGER_TOKEN } from '@main/core/tokens.js';

export interface DigestEntry {
  orgId: string;
  events: DomainEvent[];
  summary: string;
}

/**
 * Aggregates high-frequency domain events into batched digests
 * before forwarding to the Renderer via IPC.
 *
 * Two aggregation tiers:
 * - IPC batching: 200-500ms window for Renderer state updates
 * - Notification aggregation: 30s window for user-facing notifications
 *
 * Events are grouped by Epic/Org scope to prevent notification storms
 * during parallel execution.
 *
 * See Architecture §10.3 — Event Digester (IPC Batching).
 */
@injectable()
export class EventDigester {
  private buffer: DomainEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback: ((digests: DigestEntry[]) => void) | null = null;
  private ipcWindowMs: number;

  // Notification-level aggregation (longer window)
  private notificationBuffer: DomainEvent[] = [];
  private notificationTimer: ReturnType<typeof setTimeout> | null = null;
  private notificationCallback: ((digests: DigestEntry[]) => void) | null = null;
  private notificationWindowMs: number;

  constructor(
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    this.ipcWindowMs = 300;
    this.notificationWindowMs = 30000;
  }

  /**
   * Start IPC-level event digestion (fast, for Renderer updates).
   */
  start(
    eventTypes: DomainEventType[],
    flushCallback: (digests: DigestEntry[]) => void,
    windowMs?: number,
  ): void {
    this.flushCallback = flushCallback;
    if (windowMs !== undefined) this.ipcWindowMs = windowMs;

    for (const eventType of eventTypes) {
      this.eventBus.on(eventType, (event: DomainEvent) => {
        this.buffer.push(event);
        this.scheduleFlush();

        // Also buffer for notification aggregation
        this.notificationBuffer.push(event);
        this.scheduleNotificationFlush();
      });
    }

    this.logger.info('EventDigester started', {
      eventTypes: eventTypes.length,
      ipcWindowMs: this.ipcWindowMs,
      notificationWindowMs: this.notificationWindowMs,
    });
  }

  /**
   * Register a callback for notification-level aggregation (slower, for user notifications).
   */
  onNotification(
    callback: (digests: DigestEntry[]) => void,
    windowMs?: number,
  ): void {
    this.notificationCallback = callback;
    if (windowMs !== undefined) this.notificationWindowMs = windowMs;
  }

  // ─── IPC-level flush (fast) ───────────────────────────────

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.flush();
    }, this.ipcWindowMs);
  }

  private flush(): void {
    this.timer = null;
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    const digests = this.groupByOrg(events);
    this.logger.debug('EventDigester IPC flush', { count: events.length, orgs: digests.length });
    this.flushCallback?.(digests);
  }

  // ─── Notification-level flush (slow) ──────────────────────

  private scheduleNotificationFlush(): void {
    if (this.notificationTimer) return;
    this.notificationTimer = setTimeout(() => {
      this.flushNotifications();
    }, this.notificationWindowMs);
  }

  private flushNotifications(): void {
    this.notificationTimer = null;
    if (this.notificationBuffer.length === 0) return;

    const events = [...this.notificationBuffer];
    this.notificationBuffer = [];

    const digests = this.groupByOrg(events);
    this.logger.debug('EventDigester notification flush', {
      count: events.length,
      orgs: digests.length,
    });
    this.notificationCallback?.(digests);
  }

  // ─── Grouping and summarization ───────────────────────────

  private groupByOrg(events: DomainEvent[]): DigestEntry[] {
    const grouped = new Map<string, DomainEvent[]>();

    for (const e of events) {
      const orgId = (e.payload as Record<string, unknown>).orgId as string ?? 'unknown';
      const list = grouped.get(orgId) ?? [];
      list.push(e);
      grouped.set(orgId, list);
    }

    return [...grouped.entries()].map(([orgId, orgEvents]) => ({
      orgId,
      events: orgEvents,
      summary: this.summarize(orgEvents),
    }));
  }

  private summarize(events: DomainEvent[]): string {
    const counts = new Map<DomainEventType, number>();
    for (const e of events) {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }

    const parts: string[] = [];
    const taskCompleted = counts.get('task:completed') ?? 0;
    const taskChanged = counts.get('task:status-changed') ?? 0;
    const runSucceeded = counts.get('run:succeeded') ?? 0;
    const runFailed = counts.get('run:failed') ?? 0;
    const voteAdded = counts.get('discussion:vote-added') ?? 0;

    if (taskCompleted > 0) parts.push(`${taskCompleted} task${taskCompleted > 1 ? 's' : ''} completed`);
    if (taskChanged > 0) parts.push(`${taskChanged} status change${taskChanged > 1 ? 's' : ''}`);
    if (runSucceeded > 0) parts.push(`${runSucceeded} run${runSucceeded > 1 ? 's' : ''} succeeded`);
    if (runFailed > 0) parts.push(`${runFailed} run${runFailed > 1 ? 's' : ''} failed`);
    if (voteAdded > 0) parts.push(`${voteAdded} vote${voteAdded > 1 ? 's' : ''} cast`);

    // Catch any remaining event types not explicitly handled
    for (const [type, count] of counts) {
      if (!['task:completed', 'task:status-changed', 'run:succeeded', 'run:failed', 'discussion:vote-added'].includes(type)) {
        parts.push(`${count} ${type}`);
      }
    }

    return parts.join(', ') || 'No significant changes';
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.notificationTimer) {
      clearTimeout(this.notificationTimer);
      this.notificationTimer = null;
    }
    this.flush();
    this.flushNotifications();
  }
}
