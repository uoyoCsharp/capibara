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
  task_node_id: string | null;
  priority: number;
  created_at: string;
}

function rowToEntity(row: WakeRow): PendingWake {
  return {
    id: row.id,
    roleId: row.role_id,
    orgId: row.org_id,
    trigger: row.trigger as PendingWake['trigger'],
    taskNodeId: row.task_node_id,
    priority: row.priority ?? 0,
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
      .prepare('SELECT * FROM pending_wakes WHERE org_id = ? ORDER BY priority DESC, created_at ASC')
      .all(orgId) as WakeRow[];
    return rows.map(rowToEntity);
  }

  async findHighestPriority(roleId: string, orgId: string): Promise<PendingWake | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE role_id = ? AND org_id = ? ORDER BY priority DESC, created_at ASC LIMIT 1')
      .get(roleId, orgId) as WakeRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async create(input: CreatePendingWakeInput): Promise<PendingWake> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO pending_wakes (id, role_id, org_id, trigger, task_node_id, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.roleId, input.orgId, input.trigger, input.taskNodeId ?? null, input.priority ?? 0, now);

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

  async consumeByRoleAndTask(roleId: string, taskNodeId: string): Promise<number> {
    const result = this.conn.getDb()
      .prepare('DELETE FROM pending_wakes WHERE role_id = ? AND task_node_id = ?')
      .run(roleId, taskNodeId);
    return result.changes;
  }
}
