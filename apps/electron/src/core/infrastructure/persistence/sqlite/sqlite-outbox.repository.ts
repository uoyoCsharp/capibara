import { injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IOutboxRepository, OutboxRow } from '@core/foundation/interfaces/i-outbox.repository';
import type { DomainEventType, DomainEventMap } from '@core/foundation/events';
import { parseEventPayload } from '@core/foundation/event-schemas';

interface RawRow {
  id: string;
  event_type: string;
  payload: string;
  created_at: string;
}

@injectable()
export class SqliteOutboxRepository implements IOutboxRepository {
  constructor(private readonly conn: ISqliteConnection) {}

  enqueue<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): string {
    const id = randomUUID();
    this.conn
      .getDb()
      .prepare('INSERT INTO outbox (id, event_type, payload) VALUES (?, ?, ?)')
      .run(id, type, JSON.stringify(payload));
    return id;
  }

  findUnpublished(limit: number): OutboxRow[] {
    const rows = this.conn
      .getDb()
      .prepare(
        'SELECT id, event_type, payload, created_at FROM outbox WHERE published_at IS NULL ORDER BY created_at ASC LIMIT ?',
      )
      .all(limit) as RawRow[];

    return rows.map((r) => {
      const type = r.event_type as DomainEventType;
      const raw = JSON.parse(r.payload) as unknown;
      return {
        id: r.id,
        eventType: type,
        payload: parseEventPayload(type, raw),
        createdAt: r.created_at,
      };
    });
  }

  markPublished(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.conn
      .getDb()
      .prepare(
        `UPDATE outbox SET published_at = datetime('now') WHERE id IN (${placeholders})`,
      )
      .run(...ids);
  }
}
