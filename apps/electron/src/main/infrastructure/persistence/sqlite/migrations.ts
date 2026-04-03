import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Create organizations table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
          budget_limit REAL NOT NULL DEFAULT 50.0,
          org_template_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    description: 'Create schema version table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 3,
    description: 'Create settings table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    description: 'Create roles table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          parent_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
          persona TEXT NOT NULL DEFAULT '',
          knowledge_base_refs TEXT NOT NULL DEFAULT '[]',
          skill_ids TEXT NOT NULL DEFAULT '[]',
          can_approve INTEGER NOT NULL DEFAULT 0,
          can_delegate INTEGER NOT NULL DEFAULT 0,
          requires_human_approval INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'idle')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 5,
    description: 'Create task_nodes table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_nodes (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES task_nodes(id) ON DELETE SET NULL,
          type TEXT NOT NULL CHECK (type IN ('epic', 'story', 'task', 'subtask', 'spike', 'bug', 'chore')),
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'awaiting_review', 'revision', 'approved', 'done', 'blocked', 'cancelled')),
          assignee_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
          depth INTEGER NOT NULL DEFAULT 0,
          artifact_paths TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 6,
    description: 'Create skills table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          command TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL CHECK (category IN ('analysis', 'design', 'implementation', 'review', 'test', 'general')),
          source TEXT NOT NULL CHECK (source IN ('builtin', 'template', 'custom')),
          org_template_id TEXT,
          custom_prompt_content TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 7,
    description: 'Create discussion_groups and discussion_messages tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS discussion_groups (
          id TEXT PRIMARY KEY,
          task_node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
          summary TEXT,
          last_summary_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS discussion_messages (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES discussion_groups(id) ON DELETE CASCADE,
          author_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
          author_type TEXT NOT NULL CHECK (author_type IN ('ai', 'human', 'system')),
          content TEXT NOT NULL,
          vote_tag TEXT CHECK (vote_tag IN ('APPROVE', 'REVISE', 'CONCERN', 'DELEGATE') OR vote_tag IS NULL),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 8,
    description: 'Create runs table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          task_node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
          trigger TEXT NOT NULL,
          output_log TEXT NOT NULL DEFAULT '',
          started_at TEXT,
          finished_at TEXT,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 9,
    description: 'Create cost_entries table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cost_entries (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          token_count INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 10,
    description: 'Create narratives table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS narratives (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          template_data TEXT NOT NULL DEFAULT '{}',
          rendered_text TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 11,
    description: 'Create pending_wakes table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pending_wakes (
          id TEXT PRIMARY KEY,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          trigger TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 12,
    description: 'Add workspace_path column to organizations',
    up: (db) => {
      db.exec(`
        ALTER TABLE organizations ADD COLUMN workspace_path TEXT NOT NULL DEFAULT '';
      `);
    },
  },
  {
    version: 13,
    description: 'Drop output_log column from runs (logs moved to filesystem)',
    up: (db) => {
      // SQLite >= 3.35.0 supports DROP COLUMN.
      // For older versions, fall back to recreate-table strategy.
      try {
        db.exec(`ALTER TABLE runs DROP COLUMN output_log;`);
      } catch {
        // Fallback: recreate table without output_log
        db.exec(`
          CREATE TABLE runs_new (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            task_node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
            role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
            trigger TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            cost_usd REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO runs_new (id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, cost_usd, created_at)
            SELECT id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, cost_usd, created_at FROM runs;
          DROP TABLE runs;
          ALTER TABLE runs_new RENAME TO runs;
        `);
      }
    },
  },
  {
    version: 14,
    description: 'Add token_count column to runs table',
    up: (db) => {
      db.exec(`ALTER TABLE runs ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0;`);
    },
  },
  {
    version: 15,
    description: 'Add session_id column to runs table for --resume support',
    up: (db) => {
      db.exec(`ALTER TABLE runs ADD COLUMN session_id TEXT;`);
    },
  },
  {
    version: 16,
    description: 'Add review_round, metadata to discussion_messages; current_round, revise_count to discussion_groups; task_node_id to pending_wakes; consecutive_wake_count to roles',
    up: (db) => {
      db.exec(`
        ALTER TABLE discussion_messages ADD COLUMN review_round INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE discussion_messages ADD COLUMN metadata TEXT;
        ALTER TABLE discussion_groups ADD COLUMN current_round INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE discussion_groups ADD COLUMN revise_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE pending_wakes ADD COLUMN task_node_id TEXT REFERENCES task_nodes(id) ON DELETE SET NULL;
        ALTER TABLE roles ADD COLUMN consecutive_wake_count INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const getCurrentVersion = db.prepare(
    'SELECT MAX(version) as version FROM schema_version',
  );
  const insertVersion = db.prepare(
    'INSERT INTO schema_version (version, description) VALUES (?, ?)',
  );

  const row = getCurrentVersion.get() as { version: number | null } | undefined;
  const currentVersion = row?.version ?? 0;

  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      insertVersion.run(migration.version, migration.description);
    }
  });

  applyAll();
}
