import { randomUUID } from 'node:crypto';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

export interface ConversationEvent {
  id: string;
  workflowId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdAt: string;
}

interface EventRow {
  id: string;
  workflow_id: string;
  event_type: string;
  event_payload: string;
  created_at: string;
}

function rowToEvent(row: EventRow): ConversationEvent {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.event_payload); } catch { /* malformed JSON */ }
  return {
    id: row.id,
    workflowId: row.workflow_id,
    eventType: row.event_type,
    eventPayload: payload,
    createdAt: row.created_at,
  };
}

export class ConversationEventLogger {
  constructor(
    private readonly conn: ISqliteConnection,
    private readonly logger: ILogger,
  ) {}

  log(workflowId: string, eventType: string, payload: Record<string, unknown>): void {
    try {
      const id = randomUUID();
      this.conn.getDb().prepare(`
        INSERT INTO conversation_events (id, workflow_id, event_type, event_payload, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(id, workflowId, eventType, JSON.stringify(payload));
    } catch (err) {
      this.logger.error('Failed to log conversation event', {
        workflowId,
        eventType,
        error: String(err),
      });
    }
  }

  findByWorkflowId(workflowId: string): ConversationEvent[] {
    try {
      const rows = this.conn.getDb()
        .prepare('SELECT * FROM conversation_events WHERE workflow_id = ? ORDER BY created_at ASC')
        .all(workflowId) as EventRow[];
      return rows.map(rowToEvent);
    } catch (err) {
      this.logger.error('Failed to query conversation events', { workflowId, error: String(err) });
      return [];
    }
  }

  findByWorkflowIds(workflowIds: string[]): ConversationEvent[] {
    if (workflowIds.length === 0) return [];
    try {
      const results: ConversationEvent[] = [];
      // Chunk to stay within SQLite's max variable limit (999)
      for (let i = 0; i < workflowIds.length; i += 500) {
        const chunk = workflowIds.slice(i, i + 500);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = this.conn.getDb()
          .prepare(`SELECT * FROM conversation_events WHERE workflow_id IN (${placeholders}) ORDER BY created_at ASC`)
          .all(...chunk) as EventRow[];
        results.push(...rows.map(rowToEvent));
      }
      return results;
    } catch (err) {
      this.logger.error('Failed to query conversation events', { error: String(err) });
      return [];
    }
  }

  countByTypeContaining(orgWorkflowIds: string[], eventType: string, payloadSubstring: string): number {
    if (orgWorkflowIds.length === 0) return 0;
    try {
      // Escape LIKE wildcards in the payload substring
      const escapedSubstring = payloadSubstring.replace(/[%_]/g, '\\$&');
      let total = 0;
      // Chunk to stay within SQLite's max variable limit (999, minus 2 for eventType and LIKE)
      for (let i = 0; i < orgWorkflowIds.length; i += 497) {
        const chunk = orgWorkflowIds.slice(i, i + 497);
        const placeholders = chunk.map(() => '?').join(',');
        const row = this.conn.getDb()
          .prepare(`
            SELECT COUNT(*) as cnt FROM conversation_events
            WHERE workflow_id IN (${placeholders})
              AND event_type = ?
              AND event_payload LIKE ? ESCAPE '\\'
          `)
          .get(...chunk, eventType, `%${escapedSubstring}%`) as { cnt: number };
        total += row.cnt;
      }
      return total;
    } catch (err) {
      this.logger.error('Failed to count conversation events', { error: String(err) });
      return 0;
    }
  }
}
