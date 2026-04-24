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

describe.skipIf(!canUseSqlite)('v1 baseline migration', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(async () => {
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => db?.close());

  const EXPECTED_TABLES = [
    'organizations',
    'settings',
    'roles',
    'skills',
    'tasks',
    'process_schemas',
    'conversations',
    'conversation_messages',
    'conversation_events',
    'runs',
    'cost_entries',
    'pending_wakes',
    'outbox',
    'schema_version',
  ] as const;

  it('creates all expected tables', () => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const t of EXPECTED_TABLES) {
      expect(names.has(t), `expected table ${t}`).toBe(true);
    }
  });

  it('records v1 in schema_version', () => {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);
  });

  it('runs has CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL)', () => {
    db.exec(`INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'o', '/tmp')`);
    db.exec(`INSERT INTO roles (id, org_id, name) VALUES ('role-1', 'org-1', 'R')`);

    expect(() => {
      db.prepare(
        `INSERT INTO runs (id, org_id, role_id, wake_reason) VALUES ('r-bad', 'org-1', 'role-1', 'task_assigned')`,
      ).run();
    }).toThrow(/CHECK/i);
  });

  it('runs unique index prevents two active runs for the same role', () => {
    db.exec(`INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'o', '/tmp')`);
    db.exec(`INSERT INTO roles (id, org_id, name) VALUES ('role-1', 'org-1', 'R')`);
    db.exec(`INSERT INTO tasks (id, org_id, type, title) VALUES ('task-1', 'org-1', 'task', 'T')`);

    db.prepare(`INSERT INTO runs (id, org_id, task_id, role_id, wake_reason, status) VALUES ('r-1', 'org-1', 'task-1', 'role-1', 'task_assigned', 'running')`).run();
    expect(() => {
      db.prepare(`INSERT INTO runs (id, org_id, task_id, role_id, wake_reason, status) VALUES ('r-2', 'org-1', 'task-1', 'role-1', 'task_assigned', 'queued')`).run();
    }).toThrow(/UNIQUE/i);
  });

  it('tasks has paused_reason column', () => {
    const cols = db.pragma('table_info(tasks)') as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    expect(names.has('paused_reason')).toBe(true);
  });

  it('outbox has published_at column and unpublished index', () => {
    const cols = db.pragma('table_info(outbox)') as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'published_at')).toBe(true);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='outbox'").all() as Array<{ name: string }>;
    expect(indexes.some((i) => i.name === 'idx_outbox_unpublished')).toBe(true);
  });
});

describe.skipIf(canUseSqlite)('v1 baseline migration (skipped on this runner)', () => {
  it('skipped', () => expect(SQLITE_SKIP_REASON).toBeDefined());
});
