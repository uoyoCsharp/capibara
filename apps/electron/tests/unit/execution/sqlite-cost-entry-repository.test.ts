import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLITE_SKIP_REASON } from '../../helpers/test-db';

let Database: typeof import('better-sqlite3').default;
let canUseSqlite = false;

try {
  Database = (await import('better-sqlite3')).default;
  new Database(':memory:');
  canUseSqlite = true;
} catch {
  canUseSqlite = false;
}

describe.skipIf(!canUseSqlite)('SqliteCostEntryRepository', () => {
  let db: InstanceType<typeof Database>;
  let repo: import('@core/modules/execution/persistence/sqlite-cost-entry.repository').SqliteCostEntryRepository;

  beforeEach(async () => {
    const { SqliteCostEntryRepository } = await import('@core/modules/execution/persistence/sqlite-cost-entry.repository');
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const connection = { getDb: () => db, close: () => db.close() };
    repo = new SqliteCostEntryRepository(connection);

    db.exec(`
      INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'Test Org', '/tmp');
      INSERT INTO roles (id, org_id, name) VALUES ('role-1', 'org-1', 'Dev');
      INSERT INTO runs (id, org_id, role_id, status, wake_reason) VALUES ('run-1', 'org-1', 'role-1', 'succeeded', 'task_assigned');
      INSERT INTO runs (id, org_id, role_id, status, wake_reason) VALUES ('run-2', 'org-1', 'role-1', 'succeeded', 'task_assigned');
    `);
  });

  afterEach(() => {
    db?.close();
  });

  describe('create', () => {
    it('creates a cost entry with correct fields', () => {
      const entry = repo.create({ runId: 'run-1', roleId: 'role-1', orgId: 'org-1', tokenCount: 1500, costUsd: 0.015 });

      expect(entry.id).toBeDefined();
      expect(entry.tokenCount).toBe(1500);
      expect(entry.costUsd).toBe(0.015);
    });
  });

  describe('getTotalTokensByOrgId', () => {
    it('returns sum of tokens for org', () => {
      repo.create({ runId: 'run-1', roleId: 'role-1', orgId: 'org-1', tokenCount: 1000, costUsd: 0.01 });
      repo.create({ runId: 'run-2', roleId: 'role-1', orgId: 'org-1', tokenCount: 2500, costUsd: 0.025 });

      expect(repo.getTotalTokensByOrgId('org-1')).toBe(3500);
    });

    it('returns 0 when no entries', () => {
      expect(repo.getTotalTokensByOrgId('org-empty')).toBe(0);
    });
  });

  describe('getTotalCostByOrgId', () => {
    it('returns sum of cost for org', () => {
      repo.create({ runId: 'run-1', roleId: 'role-1', orgId: 'org-1', tokenCount: 1000, costUsd: 0.01 });
      repo.create({ runId: 'run-2', roleId: 'role-1', orgId: 'org-1', tokenCount: 2000, costUsd: 0.03 });

      expect(repo.getTotalCostByOrgId('org-1')).toBeCloseTo(0.04);
    });
  });
});

describe.skipIf(canUseSqlite)(SQLITE_SKIP_REASON, () => {
  it('SQLite tests skipped — native module not available for system Node.js', () => {
    expect(true).toBe(true);
  });
});
