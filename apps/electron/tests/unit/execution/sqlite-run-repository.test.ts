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

describe.skipIf(!canUseSqlite)('SqliteRunRepository', () => {
  let db: InstanceType<typeof Database>;
  let repo: import('@core/modules/execution/persistence/sqlite-run.repository').SqliteRunRepository;

  beforeEach(async () => {
    const { SqliteRunRepository } = await import('@core/modules/execution/persistence/sqlite-run.repository');
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const connection = { getDb: () => db, close: () => db.close() };
    repo = new SqliteRunRepository(connection);

    db.exec(`
      INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'Test Org', '/tmp');
      INSERT INTO roles (id, org_id, name) VALUES ('role-1', 'org-1', 'Dev');
    `);
  });

  afterEach(() => {
    db?.close();
  });

  describe('create', () => {
    it('creates a run with queued status', () => {
      const run = repo.create({ orgId: 'org-1', taskId: null, conversationId: null, roleId: 'role-1', wakeReason: 'task_assigned' });

      expect(run.id).toBeDefined();
      expect(run.status).toBe('queued');
      expect(run.orgId).toBe('org-1');
      expect(run.roleId).toBe('role-1');
    });
  });

  describe('findById', () => {
    it('returns run when exists', () => {
      const created = repo.create({ orgId: 'org-1', taskId: null, conversationId: null, roleId: 'role-1', wakeReason: 'task_assigned' });
      expect(repo.findById(created.id)).not.toBeNull();
    });

    it('returns null when not exists', () => {
      expect(repo.findById('nonexistent')).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates status to running and sets started_at', () => {
      const run = repo.create({ orgId: 'org-1', taskId: null, conversationId: null, roleId: 'role-1', wakeReason: 'task_assigned' });
      repo.updateStatus(run.id, 'running');
      const updated = repo.findById(run.id)!;
      expect(updated.status).toBe('running');
      expect(updated.startedAt).not.toBeNull();
    });
  });

  describe('finish', () => {
    it('sets finished_at and status', () => {
      const run = repo.create({ orgId: 'org-1', taskId: null, conversationId: null, roleId: 'role-1', wakeReason: 'task_assigned' });
      repo.finish(run.id, 'succeeded', 1500, 0.05, 'sess-1', 'Done', null);
      const finished = repo.findById(run.id)!;
      expect(finished.status).toBe('succeeded');
      expect(finished.finishedAt).not.toBeNull();
      expect(finished.tokenCount).toBe(1500);
    });
  });

  describe('findActiveByOrgId', () => {
    it('returns null when no active runs', () => {
      const run = repo.create({ orgId: 'org-1', taskId: null, conversationId: null, roleId: 'role-1', wakeReason: 'task_assigned' });
      repo.finish(run.id, 'succeeded');
      expect(repo.findActiveByOrgId('org-1')).toBeNull();
    });

    it('returns active run', () => {
      repo.create({ orgId: 'org-1', taskId: null, conversationId: null, roleId: 'role-1', wakeReason: 'task_assigned' });
      expect(repo.findActiveByOrgId('org-1')).not.toBeNull();
    });
  });
});

describe.skipIf(canUseSqlite)(SQLITE_SKIP_REASON, () => {
  it('SQLite tests skipped — native module not available for system Node.js', () => {
    expect(true).toBe(true);
  });
});
