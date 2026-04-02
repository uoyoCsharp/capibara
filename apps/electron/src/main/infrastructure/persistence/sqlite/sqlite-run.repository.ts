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
  cost_usd: number;
  token_count: number;
  created_at: string;
}

/** Columns to SELECT (excludes dropped output_log) */
const RUN_COLUMNS = 'id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, cost_usd, token_count, created_at';

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
    costUsd: row.cost_usd,
    tokenCount: row.token_count,
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
      INSERT INTO runs (id, org_id, task_node_id, role_id, status, trigger, cost_usd, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?)
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

  async setCost(id: string, costUsd: number): Promise<void> {
    this.conn.getDb()
      .prepare('UPDATE runs SET cost_usd = ? WHERE id = ?')
      .run(costUsd, id);
  }

  async finish(id: string, status: RunStatus, costUsd: number, tokenCount?: number): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE runs SET status = ?, cost_usd = ?, token_count = ?, finished_at = ? WHERE id = ?')
      .run(status, costUsd, tokenCount ?? 0, now, id);
    if (changes.changes === 0) throw new NotFoundError('Run', id);
  }
}
