import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IPendingWakeRepository, PendingWake, CreatePendingWakeInput } from '../interfaces/i-pending-wake.repository';

interface WakeRow {
  id: string;
  role_id: string;
  org_id: string;
  reason: string;
  task_id: string | null;
  conversation_id: string | null;
  priority: number;
  created_at: string;
}

function toWake(row: WakeRow): PendingWake {
  return {
    id: row.id,
    roleId: row.role_id,
    orgId: row.org_id,
    reason: row.reason,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqlitePendingWakeRepository implements IPendingWakeRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): PendingWake | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE id = ?')
      .get(id) as WakeRow | undefined;
    return row ? toWake(row) : null;
  }

  findByOrgId(orgId: string): PendingWake[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE org_id = ? ORDER BY priority DESC, created_at')
      .all(orgId) as WakeRow[];
    return rows.map(toWake);
  }

  findByRoleId(roleId: string): PendingWake[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE role_id = ? ORDER BY priority DESC, created_at')
      .all(roleId) as WakeRow[];
    return rows.map(toWake);
  }

  findNext(orgId: string): PendingWake | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM pending_wakes WHERE org_id = ? ORDER BY priority DESC, created_at LIMIT 1')
      .get(orgId) as WakeRow | undefined;
    return row ? toWake(row) : null;
  }

  create(input: CreatePendingWakeInput): PendingWake {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('INSERT INTO pending_wakes (id, role_id, org_id, reason, task_id, conversation_id, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.roleId, input.orgId, input.reason, input.taskId, input.conversationId, input.priority, now);
    return this.findById(id)!;
  }

  delete(id: string): void {
    this.connection.getDb().prepare('DELETE FROM pending_wakes WHERE id = ?').run(id);
  }

  deleteByRoleId(roleId: string): void {
    this.connection.getDb().prepare('DELETE FROM pending_wakes WHERE role_id = ?').run(roleId);
  }
}
