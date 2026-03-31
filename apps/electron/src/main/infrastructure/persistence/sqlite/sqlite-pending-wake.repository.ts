import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { PendingWake } from '@main/core/types/domain.types.js';
import type { IPendingWakeRepository, CreatePendingWakeInput } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

interface WakeRow {
  id: string;
  role_id: string;
  org_id: string;
  trigger: string;
  created_at: string;
}

function rowToEntity(row: WakeRow): PendingWake {
  return {
    id: row.id,
    roleId: row.role_id,
    orgId: row.org_id,
    trigger: row.trigger as PendingWake['trigger'],
    createdAt: row.created_at,
  };
}

@injectable()
export class SqlitePendingWakeRepository implements IPendingWakeRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findByRoleId(roleId: string): Promise<PendingWake[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE role_id = ? ORDER BY created_at')
      .all(roleId) as WakeRow[];
    return rows.map(rowToEntity);
  }

  async findByOrgId(orgId: string): Promise<PendingWake[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE org_id = ? ORDER BY created_at')
      .all(orgId) as WakeRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreatePendingWakeInput): Promise<PendingWake> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO pending_wakes (id, role_id, org_id, trigger, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.roleId, input.orgId, input.trigger, now);

    const row = this.conn.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE id = ?')
      .get(id) as WakeRow;
    return rowToEntity(row);
  }

  async consume(id: string): Promise<void> {
    this.conn.getDb()
      .prepare('DELETE FROM pending_wakes WHERE id = ?')
      .run(id);
  }

  async consumeAllForRole(roleId: string): Promise<number> {
    const result = this.conn.getDb()
      .prepare('DELETE FROM pending_wakes WHERE role_id = ?')
      .run(roleId);
    return result.changes;
  }
}
