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
  summary: string | null;
  error_message: string | null;
  acp_session_id: string | null;
  agent_id: string | null;
  created_at: string;
}

function toRun(row: RunRow): Run {
  const base = {
    id: row.id,
    orgId: row.org_id,
    roleId: row.role_id,
    status: row.status as RunStatus,
    wakeReason: row.wake_reason as Run['wakeReason'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,
    tokenCount: row.token_count,
    summary: row.summary,
    errorMessage: row.error_message,
    acpSessionId: row.acp_session_id ?? null,
    agentId: row.agent_id ?? null,
    createdAt: row.created_at,
  };

  if (row.task_id && row.conversation_id) {
    return { ...base, taskId: row.task_id, conversationId: row.conversation_id };
  }
  if (row.task_id) {
    return { ...base, taskId: row.task_id, conversationId: null };
  }
  if (row.conversation_id) {
    return { ...base, taskId: null, conversationId: row.conversation_id };
  }
  // DB CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL) prevents this,
  // but surface it clearly if it ever occurs (corrupted row).
  throw new Error(`Run ${row.id} has neither taskId nor conversationId`);
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
      .prepare("SELECT * FROM runs WHERE role_id = ? AND status = 'running' LIMIT 1")
      .get(roleId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  findActiveByOrgId(orgId: string): Run | null {
    const row = this.connection.getDb()
      .prepare("SELECT * FROM runs WHERE org_id = ? AND status = 'running' LIMIT 1")
      .get(orgId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  findByConversationId(conversationId: string): Run | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(conversationId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  create(input: CreateRunInput): Run {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO runs (id, org_id, task_id, conversation_id, role_id, status, wake_reason, started_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
      `)
      .run(input.id, input.orgId, input.taskId, input.conversationId, input.roleId, input.wakeReason, now, now);
    return this.findById(input.id)!;
  }

  updateStatus(id: string, status: RunStatus): void {
    this.connection.getDb()
      .prepare('UPDATE runs SET status = ? WHERE id = ?')
      .run(status, id);
  }

  finish(id: string, status: RunStatus, tokenCount?: number, costUsd?: number, sessionId?: string | null, summary?: string | null, errorMessage?: string | null): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        UPDATE runs
        SET status = ?, finished_at = ?, token_count = COALESCE(?, token_count), cost_usd = COALESCE(?, cost_usd),
            summary = COALESCE(?, summary), error_message = COALESCE(?, error_message)
        WHERE id = ?
      `)
      .run(status, now, tokenCount ?? null, costUsd ?? null, summary ?? null, errorMessage ?? null, id);
  }

  markOrphanedAsInterrupted(): number {
    const now = new Date().toISOString();
    const result = this.connection.getDb()
      .prepare(`
        UPDATE runs
        SET status = 'interrupted',
            finished_at = COALESCE(finished_at, ?),
            error_message = COALESCE(error_message, 'Interrupted by app restart')
        WHERE status = 'running'
      `)
      .run(now);
    return result.changes;
  }
}
