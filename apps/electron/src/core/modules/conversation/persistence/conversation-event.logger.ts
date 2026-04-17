import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';

@injectable()
export class ConversationEventLogger {
  constructor(private readonly connection: ISqliteConnection) {}

  log(conversationId: string, eventType: string, payload?: Record<string, unknown>): void {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO conversation_events (id, conversation_id, event_type, event_payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, conversationId, eventType, payload ? JSON.stringify(payload) : null, now);
  }

  findByConversationId(conversationId: string): Array<{ id: string; eventType: string; eventPayload: string | null; createdAt: string }> {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM conversation_events WHERE conversation_id = ? ORDER BY created_at')
      .all(conversationId) as Array<{ id: string; event_type: string; event_payload: string | null; created_at: string }>;
    return rows.map((r) => ({ id: r.id, eventType: r.event_type, eventPayload: r.event_payload, createdAt: r.created_at }));
  }
}
