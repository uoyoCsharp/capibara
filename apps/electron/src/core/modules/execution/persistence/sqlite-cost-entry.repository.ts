import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { ICostEntryRepository } from '../interfaces/i-cost-entry.repository';
import type { CostEntry, CreateCostEntryInput } from '../types/execution.types';

interface CostEntryRow {
  id: string;
  run_id: string;
  role_id: string;
  org_id: string;
  token_count: number;
  cost_usd: number;
  created_at: string;
}

function toCostEntry(row: CostEntryRow): CostEntry {
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
  constructor(private readonly connection: ISqliteConnection) {}

  findByRunId(runId: string): CostEntry[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM cost_entries WHERE run_id = ? ORDER BY created_at DESC')
      .all(runId) as CostEntryRow[];
    return rows.map(toCostEntry);
  }

  findByOrgId(orgId: string): CostEntry[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM cost_entries WHERE org_id = ? ORDER BY created_at DESC')
      .all(orgId) as CostEntryRow[];
    return rows.map(toCostEntry);
  }

  getTotalTokensByOrgId(orgId: string): number {
    const row = this.connection.getDb()
      .prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM cost_entries WHERE org_id = ?')
      .get(orgId) as { total: number };
    return row.total;
  }

  getTotalCostByOrgId(orgId: string): number {
    const row = this.connection.getDb()
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE org_id = ?')
      .get(orgId) as { total: number };
    return row.total;
  }

  create(input: CreateCostEntryInput): CostEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(`
        INSERT INTO cost_entries (id, run_id, role_id, org_id, token_count, cost_usd, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, input.runId, input.roleId, input.orgId, input.tokenCount, input.costUsd, now);
    return { id, ...input, createdAt: now };
  }
}
