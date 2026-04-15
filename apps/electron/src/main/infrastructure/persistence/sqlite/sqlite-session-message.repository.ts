import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { SessionMessage } from '@main/core/types/session.types.js';
import type { ISessionMessageRepository, CreateSessionMessageInput } from '@main/core/interfaces/i-session-message.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

interface SessionMessageRow {
  id: string;
  session_id: string;
  author_type: string;
  content: string;
  created_at: string;
}

const MESSAGE_COLUMNS = 'id, session_id, author_type, content, created_at';

function rowToEntity(row: SessionMessageRow): SessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    authorType: row.author_type as SessionMessage['authorType'],
    content: row.content,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteSessionMessageRepository implements ISessionMessageRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<SessionMessage | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM session_messages WHERE id = ?`)
      .get(id) as SessionMessageRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findBySessionId(sessionId: string): Promise<SessionMessage[]> {
    const rows = this.conn.getDb()
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM session_messages WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as SessionMessageRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateSessionMessageInput): Promise<SessionMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO session_messages (id, session_id, author_type, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.sessionId, input.authorType, input.content, now);

    return (await this.findById(id))!;
  }

  async countBySessionId(sessionId: string): Promise<number> {
    const row = this.conn.getDb()
      .prepare('SELECT COUNT(*) as count FROM session_messages WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  }
}
