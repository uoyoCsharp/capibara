import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IRunRepository } from '../interfaces/i-run.repository';
import type { Run, RunStatus, CreateRunInput } from '../types/execution.types';

interface RunRow {
  id: string;
  org_id: string;
  task_id: string | null;
  conversation_id: string | null;
  role_id: string;
  status: string;
  wake_reason: string;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
  token_count: number;
  created_at: string;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    orgId: row.org_id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    roleId: row.role_id,
    status: row.status as RunStatus,
    wakeReason: row.wake_reason as Run['wakeReason'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteRunRepository implements IRunRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): Run | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  findByOrgId(orgId: string): Run[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM runs WHERE org_id = ? ORDER BY created_at DESC')
      .all(orgId) as RunRow[];
    return rows.map(toRun);
  }

  findByTaskId(taskId: string): Run[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as RunRow[];
    return rows.map(toRun);
  }

  findActiveByRoleId(roleId: string): Run | null {
    const row = this.connection.getDb()
      .prepare("SELECT * FROM runs WHERE role_id = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(roleId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  findActiveByOrgId(orgId: string): Run | null {
    const row = this.connection.getDb()
      .prepare("SELECT * FROM runs WHERE org_id = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(orgId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  create(input: CreateRunInput): Run {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO runs (id, org_id, task_id, conversation_id, role_id, status, wake_reason, created_at)
        VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
      `)
      .run(id, input.orgId, input.taskId, input.conversationId, input.roleId, input.wakeReason, now);
    return this.findById(id)!;
  }

  updateStatus(id: string, status: RunStatus): void {
    const updates: Record<string, string | null> = { status };
    if (status === 'running') {
      updates.started_at = new Date().toISOString();
    }
    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    this.connection.getDb()
      .prepare(`UPDATE runs SET ${setClauses} WHERE id = ?`)
      .run(...Object.values(updates), id);
  }

  finish(id: string, status: RunStatus, tokenCount?: number, costUsd?: number, sessionId?: string | null): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        UPDATE runs
        SET status = ?, finished_at = ?, token_count = COALESCE(?, token_count), cost_usd = COALESCE(?, cost_usd)
        WHERE id = ?
      `)
      .run(status, now, tokenCount ?? null, costUsd ?? null, id);
  }
}
