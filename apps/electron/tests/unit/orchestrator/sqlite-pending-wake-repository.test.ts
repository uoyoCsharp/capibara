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

describe.skipIf(!canUseSqlite)('SqlitePendingWakeRepository', () => {
  let db: InstanceType<typeof Database>;
  let repo: import('@core/modules/orchestrator/persistence/sqlite-pending-wake.repository').SqlitePendingWakeRepository;

  beforeEach(async () => {
    const { SqlitePendingWakeRepository } = await import('@core/modules/orchestrator/persistence/sqlite-pending-wake.repository');
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const connection = { getDb: () => db, close: () => db.close() };
    repo = new SqlitePendingWakeRepository(connection);

    db.exec(`
      INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'Test Org', '/tmp');
      INSERT INTO roles (id, org_id, name) VALUES ('role-1', 'org-1', 'Dev');
      INSERT INTO roles (id, org_id, name) VALUES ('role-2', 'org-1', 'Lead');
      INSERT INTO tasks (id, org_id, type, title, description, status) VALUES ('task-1', 'org-1', 'task', 'Test Task', '', 'todo');
    `);
  });

  afterEach(() => {
    db?.close();
  });

  describe('create', () => {
    it('creates pending wake with correct fields', () => {
      const wake = repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'task_assigned', taskId: 'task-1', priority: 0 });
      expect(wake.id).toBeDefined();
      expect(wake.roleId).toBe('role-1');
      expect(wake.reason).toBe('task_assigned');
      expect(wake.priority).toBe(0);
    });
  });

  describe('findById', () => {
    it('returns wake when exists', () => {
      const created = repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'task_assigned', taskId: null, priority: 0 });
      expect(repo.findById(created.id)).not.toBeNull();
    });

    it('returns null when not exists', () => {
      expect(repo.findById('nonexistent')).toBeNull();
    });
  });

  describe('findByOrgId', () => {
    it('returns wakes ordered by priority desc, then created_at', () => {
      repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'low', taskId: null, priority: 0 });
      repo.create({ roleId: 'role-2', orgId: 'org-1', reason: 'high', taskId: null, priority: 5 });
      const wakes = repo.findByOrgId('org-1');
      expect(wakes).toHaveLength(2);
      expect(wakes[0].reason).toBe('high');
      expect(wakes[1].reason).toBe('low');
    });
  });

  describe('findByRoleId', () => {
    it('returns wakes for specific role', () => {
      repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'a', taskId: null, priority: 0 });
      repo.create({ roleId: 'role-2', orgId: 'org-1', reason: 'b', taskId: null, priority: 0 });
      expect(repo.findByRoleId('role-1')).toHaveLength(1);
    });
  });

  describe('findNext', () => {
    it('returns highest priority wake for org', () => {
      repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'low', taskId: null, priority: 0 });
      repo.create({ roleId: 'role-2', orgId: 'org-1', reason: 'high', taskId: null, priority: 10 });
      const next = repo.findNext('org-1');
      expect(next).not.toBeNull();
      expect(next!.reason).toBe('high');
    });

    it('returns null when no wakes for org', () => {
      expect(repo.findNext('org-empty')).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes specific wake', () => {
      const wake = repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'x', taskId: null, priority: 0 });
      repo.delete(wake.id);
      expect(repo.findById(wake.id)).toBeNull();
    });
  });

  describe('deleteByRoleId', () => {
    it('removes all wakes for role', () => {
      repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'a', taskId: null, priority: 0 });
      repo.create({ roleId: 'role-1', orgId: 'org-1', reason: 'b', taskId: null, priority: 0 });
      repo.create({ roleId: 'role-2', orgId: 'org-1', reason: 'c', taskId: null, priority: 0 });
      repo.deleteByRoleId('role-1');
      expect(repo.findByRoleId('role-1')).toHaveLength(0);
      expect(repo.findByRoleId('role-2')).toHaveLength(1);
    });
  });
});

describe.skipIf(canUseSqlite)(SQLITE_SKIP_REASON, () => {
  it('SQLite tests skipped — native module not available for system Node.js', () => {
    expect(true).toBe(true);
  });
});
