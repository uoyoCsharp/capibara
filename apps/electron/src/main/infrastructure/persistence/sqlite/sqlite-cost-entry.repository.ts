import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { CostEntry } from '@main/core/types/domain.types.js';
import type { ICostEntryRepository, CreateCostEntryInput } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';

interface CostRow {
  id: string;
  run_id: string;
  role_id: string;
  org_id: string;
  token_count: number;
  cost_usd: number;
  created_at: string;
}

function rowToEntity(row: CostRow): CostEntry {
  return {
    id: row.id,
    runId: row.run_id,
    roleId: row.role_id,
    orgId: row.org_id,
    tokenCount: row.token_count,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteCostEntryRepository implements ICostEntryRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findByRunId(runId: string): Promise<CostEntry[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM cost_entries WHERE run_id = ? ORDER BY created_at')
      .all(runId) as CostRow[];
    return rows.map(rowToEntity);
  }

  async findByOrgId(orgId: string): Promise<CostEntry[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM cost_entries WHERE org_id = ? ORDER BY created_at')
      .all(orgId) as CostRow[];
    return rows.map(rowToEntity);
  }

  async getTotalCostByOrgId(orgId: string): Promise<number> {
    const row = this.conn.getDb()
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE org_id = ?')
      .get(orgId) as { total: number };
    return row.total;
  }

  async getTotalTokensByOrgId(orgId: string): Promise<number> {
    const row = this.conn.getDb()
      .prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM cost_entries WHERE org_id = ?')
      .get(orgId) as { total: number };
    return row.total;
  }

  async create(input: CreateCostEntryInput): Promise<CostEntry> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO cost_entries (id, run_id, role_id, org_id, token_count, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.runId, input.roleId, input.orgId, input.tokenCount, input.costUsd, now);

    return (await this.findByRunId(input.runId)).find((e) => e.id === id)!;
  }
}
