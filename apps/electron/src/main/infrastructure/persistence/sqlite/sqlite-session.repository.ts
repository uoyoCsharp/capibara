import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { Session, SessionStatus, SessionType } from '@main/core/types/session.types.js';
import type { ISessionRepository, CreateSessionInput } from '@main/core/interfaces/i-session.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface SessionRow {
  id: string;
  org_id: string;
  role_id: string;
  type: string;
  status: string;
  cli_session_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

const SESSION_COLUMNS =
  'id, org_id, role_id, type, status, cli_session_id, metadata, created_at, updated_at';

function rowToEntity(row: SessionRow): Session {
  return {
    id: row.id,
    orgId: row.org_id,
    roleId: row.role_id,
    type: row.type as SessionType,
    status: row.status as SessionStatus,
    cliSessionId: row.cli_session_id,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteSessionRepository implements ISessionRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<Session | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findActiveByOrgAndType(orgId: string, type: SessionType): Promise<Session | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE org_id = ? AND type = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`)
      .get(orgId, type) as SessionRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByOrgId(orgId: string): Promise<Session[]> {
    const rows = this.conn.getDb()
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE org_id = ? ORDER BY created_at DESC`)
      .all(orgId) as SessionRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateSessionInput): Promise<Session> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const metadata = JSON.stringify(input.metadata ?? {});

    try {
      this.conn.getDb().prepare(`
        INSERT INTO sessions (id, org_id, role_id, type, status, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(id, input.orgId, input.roleId, input.type, metadata, now, now);
    } catch (err: unknown) {
      // Unique constraint on (org_id, type) WHERE status='active'
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(`An active ${input.type} session already exists for this organization`);
      }
      throw err;
    }

    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    if (changes.changes === 0) throw new NotFoundError('Session', id);
  }

  async updateCliSessionId(id: string, cliSessionId: string): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE sessions SET cli_session_id = ?, updated_at = ? WHERE id = ?')
      .run(cliSessionId, now, id);
    if (changes.changes === 0) throw new NotFoundError('Session', id);
  }

  async updateRoleId(id: string, roleId: string): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE sessions SET role_id = ?, updated_at = ? WHERE id = ?')
      .run(roleId, now, id);
    if (changes.changes === 0) throw new NotFoundError('Session', id);
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(metadata), now, id);
    if (changes.changes === 0) throw new NotFoundError('Session', id);
  }
}
