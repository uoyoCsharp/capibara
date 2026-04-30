import type Database from 'better-sqlite3';
import { MigrationBackupService } from './migration-backup';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Greenfield baseline — all tables, including outbox and concurrency constraints',
    up: (db) => {
      db.exec(`
        -- ═══════════════════════════════════════════════
        -- 1. Organizations
        -- ═══════════════════════════════════════════════
        CREATE TABLE organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          custom_instructions TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
          budget_limit REAL NOT NULL DEFAULT 50.0,
          org_template_id TEXT,
          planning_role_id TEXT,
          workspace_path TEXT NOT NULL DEFAULT '',
          auto_start_on_create INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 2. Settings
        -- ═══════════════════════════════════════════════
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- ═══════════════════════════════════════════════
        -- 3. Roles
        -- ═══════════════════════════════════════════════
        CREATE TABLE roles (
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
          consecutive_wake_count INTEGER NOT NULL DEFAULT 0,
          is_system_role INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'idle')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 4. Skills
        -- ═══════════════════════════════════════════════
        CREATE TABLE skills (
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

        -- ═══════════════════════════════════════════════
        -- 5. Tasks
        -- ═══════════════════════════════════════════════
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          assignee_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
          depth INTEGER NOT NULL DEFAULT 0,
          artifact_paths TEXT,
          paused_reason TEXT,
          planning_mode TEXT NOT NULL DEFAULT 'layered'
            CHECK (planning_mode IN ('layered','eager','preview')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 6. Process Schemas
        -- ═══════════════════════════════════════════════
        CREATE TABLE process_schemas (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          schema_json TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX idx_process_schemas_active ON process_schemas(org_id)
          WHERE is_active = 1;

        -- ═══════════════════════════════════════════════
        -- 7. Conversations (unified: inquiry + planning + adhoc)
        -- ═══════════════════════════════════════════════
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('inquiry', 'planning', 'adhoc')),
          state TEXT NOT NULL CHECK(state IN ('active', 'waiting', 'resolved', 'escalated', 'timed_out', 'cancelled', 'completed')),
          initiator_role_id TEXT NOT NULL,
          respondent_role_id TEXT,
          respondent_type TEXT CHECK(respondent_type IN ('ai', 'human')),
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          depth INTEGER NOT NULL DEFAULT 0,
          priority INTEGER NOT NULL DEFAULT 0,
          timeout_at TEXT,
          external_session_id TEXT,
          metadata TEXT DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_conversations_org_state ON conversations(org_id, state);
        CREATE INDEX idx_conversations_org_type ON conversations(org_id, type, state);
        CREATE INDEX idx_conversations_task ON conversations(task_id, state);
        CREATE INDEX idx_conversations_timeout ON conversations(timeout_at)
          WHERE state = 'waiting';

        -- ═══════════════════════════════════════════════
        -- 8. Conversation Messages
        -- ═══════════════════════════════════════════════
        CREATE TABLE conversation_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          author_role_id TEXT,
          author_type TEXT NOT NULL CHECK(author_type IN ('ai', 'human', 'system')),
          content TEXT NOT NULL,
          intent TEXT NOT NULL CHECK(intent IN ('question', 'reply', 'escalation', 'resolution', 'general')),
          in_reply_to_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_conv_messages_conversation ON conversation_messages(conversation_id, created_at);

        -- ═══════════════════════════════════════════════
        -- 9. Conversation Events (append-only audit log)
        -- ═══════════════════════════════════════════════
        CREATE TABLE conversation_events (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_conv_events_conversation ON conversation_events(conversation_id, created_at);

        -- ═══════════════════════════════════════════════
        -- 10. Runs — task_id OR conversation_id must be set
        -- ═══════════════════════════════════════════════
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
          conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
          wake_reason TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          cost_usd REAL NOT NULL DEFAULT 0,
          token_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL)
        );

        CREATE UNIQUE INDEX idx_runs_active_per_role
          ON runs(role_id)
          WHERE status IN ('queued', 'running');

        -- ═══════════════════════════════════════════════
        -- 11. Cost Entries
        -- ═══════════════════════════════════════════════
        CREATE TABLE cost_entries (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          token_count INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 12. Pending Wakes
        -- ═══════════════════════════════════════════════
        CREATE TABLE pending_wakes (
          id TEXT PRIMARY KEY,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 13. Outbox — transactional event publication
        -- ═══════════════════════════════════════════════
        CREATE TABLE outbox (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          published_at TEXT
        );

        CREATE INDEX idx_outbox_unpublished ON outbox(created_at)
          WHERE published_at IS NULL;
      `);
    },
  },
  {
    version: 2,
    description: 'Add tasks.planning_mode for preview/eager decomposition',
    up: (db) => {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN planning_mode TEXT NOT NULL DEFAULT 'layered'
          CHECK (planning_mode IN ('layered','eager','preview'));
      `);
    },
  },
  {
    version: 3,
    description: 'Mark legacy plan:submitted outbox rows as published — payload shape tightened, replay unsafe',
    up: (db) => {
      db.exec(`
        UPDATE outbox
           SET published_at = datetime('now')
         WHERE published_at IS NULL
           AND event_type = 'plan:submitted';
      `);
    },
  },
  {
    version: 4,
    description: 'Drop legacy planning event rows — plan:submitted + planning:plan-ready no longer exist in schema',
    up: (db) => {
      db.exec(`
        DELETE FROM outbox
         WHERE event_type IN ('plan:submitted', 'planning:plan-ready');
      `);
    },
  },
];

export interface RunMigrationsOptions {
  dbPath?: string;
}

export function runMigrations(db: Database.Database, options: RunMigrationsOptions = {}): void {
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

  const latestTarget = pending[pending.length - 1].version;

  if (options.dbPath) {
    const backup = new MigrationBackupService(options.dbPath);
    const backupPath = backup.backupIfNeeded(currentVersion, latestTarget);
    if (backupPath) {
      console.info(`[migrations] Pre-migration backup saved to ${backupPath}`);
    }
  }

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db);
      insertVersion.run(migration.version, migration.description);
    });
    try {
      apply();
    } catch (e) {
      console.error(`[migrations] Failed to apply migration v${migration.version}: ${e}`);
      throw e;
    }
  }
}
