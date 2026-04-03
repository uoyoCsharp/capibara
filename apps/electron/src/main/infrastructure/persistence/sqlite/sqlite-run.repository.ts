import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { Run, RunStatus } from '@main/core/types/domain.types.js';
import type { IRunRepository, CreateRunInput } from '@main/core/interfaces/i-run.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface RunRow {
  id: string;
  org_id: string;
  task_node_id: string;
  role_id: string;
  status: string;
  trigger: string;
  started_at: string | null;
  finished_at: string | null;
  token_count: number;
  session_id: string | null;
  created_at: string;
}

/** Columns to SELECT (excludes dropped output_log and legacy cost_usd) */
const RUN_COLUMNS = 'id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, token_count, session_id, created_at';

function rowToEntity(row: RunRow): Run {
  return {
    id: row.id,
    orgId: row.org_id,
    taskNodeId: row.task_node_id,
    roleId: row.role_id,
    status: row.status as RunStatus,
    trigger: row.trigger as Run['trigger'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    tokenCount: row.token_count,
    sessionId: row.session_id,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteRunRepository implements IRunRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<Run | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`)
      .get(id) as RunRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByOrgId(orgId: string): Promise<Run[]> {
    const rows = this.conn.getDb()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE org_id = ? ORDER BY created_at DESC`)
      .all(orgId) as RunRow[];
    return rows.map(rowToEntity);
  }

  async findByTaskId(taskNodeId: string): Promise<Run[]> {
    const rows = this.conn.getDb()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE task_node_id = ? ORDER BY created_at DESC`)
      .all(taskNodeId) as RunRow[];
    return rows.map(rowToEntity);
  }

  async findActiveByRoleId(roleId: string): Promise<Run | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE role_id = ? AND status IN ('queued', 'running') LIMIT 1`)
      .get(roleId) as RunRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findActiveByOrgId(orgId: string): Promise<Run | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE org_id = ? AND status IN ('queued', 'running') LIMIT 1`)
      .get(orgId) as RunRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findAnyActiveRun(): Promise<Run | null> {
    const row = this.conn.getDb()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status IN ('queued', 'running') LIMIT 1`)
      .get() as RunRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async create(input: CreateRunInput): Promise<Run> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO runs (id, org_id, task_node_id, role_id, status, trigger, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `).run(id, input.orgId, input.taskNodeId, input.roleId, input.trigger, now);

    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: RunStatus): Promise<void> {
    const updates: Record<string, string> = { status };
    if (status === 'running') {
      updates.started_at = new Date().toISOString();
    }
    const changes = this.conn.getDb()
      .prepare('UPDATE runs SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?')
      .run(status, status === 'running' ? new Date().toISOString() : null, id);
    if (changes.changes === 0) throw new NotFoundError('Run', id);
  }

  async finish(id: string, status: RunStatus, tokenCount?: number, sessionId?: string | null): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE runs SET status = ?, token_count = ?, session_id = ?, finished_at = ? WHERE id = ?')
      .run(status, tokenCount ?? 0, sessionId ?? null, now, id);
    if (changes.changes === 0) throw new NotFoundError('Run', id);
  }

  async findLastSessionId(roleId: string, taskNodeId: string): Promise<string | null> {
    const row = this.conn.getDb()
      .prepare(
        `SELECT session_id FROM runs
         WHERE role_id = ? AND task_node_id = ? AND status = 'succeeded' AND session_id IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(roleId, taskNodeId) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }
}
