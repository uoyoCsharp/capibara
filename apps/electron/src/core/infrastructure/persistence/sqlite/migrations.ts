import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Greenfield schema — all tables',
    up: (db) => {
      db.exec(`
        -- ═══════════════════════════════════════════════
        -- 1. Organizations
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          custom_instructions TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
          budget_limit REAL NOT NULL DEFAULT 50.0,
          org_template_id TEXT,
          planning_role_id TEXT,
          workspace_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 2. Settings
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- ═══════════════════════════════════════════════
        -- 3. Roles
        -- ═══════════════════════════════════════════════
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
          consecutive_wake_count INTEGER NOT NULL DEFAULT 0,
          is_system_role INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'idle')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 4. Skills
        -- ═══════════════════════════════════════════════
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

        -- ═══════════════════════════════════════════════
        -- 5. Tasks (renamed from task_nodes)
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS tasks (
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
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 6. Process Schemas (renamed from workflow_schemas)
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS process_schemas (
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
        CREATE TABLE IF NOT EXISTS conversations (
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
        CREATE TABLE IF NOT EXISTS conversation_messages (
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
        CREATE TABLE IF NOT EXISTS conversation_events (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_conv_events_conversation ON conversation_events(conversation_id, created_at);

        -- ═══════════════════════════════════════════════
        -- 10. Runs
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS runs (
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
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 11. Cost Entries
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS cost_entries (
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
        CREATE TABLE IF NOT EXISTS pending_wakes (
          id TEXT PRIMARY KEY,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 8,
    description: 'Migrate old schema to new core (rename tables, add missing tables/columns)',
    up: (db) => {
      // Rename task_nodes → tasks (if old table exists)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map((t) => t.name));

      if (tableNames.has('task_nodes') && !tableNames.has('tasks')) {
        db.exec('ALTER TABLE task_nodes RENAME TO tasks');
      }

      // Rename workflow_schemas → process_schemas (if old table exists)
      if (tableNames.has('workflow_schemas') && !tableNames.has('process_schemas')) {
        db.exec('ALTER TABLE workflow_schemas RENAME TO process_schemas');
      }

      // Create process_schemas if it still doesn't exist
      db.exec(`
        CREATE TABLE IF NOT EXISTS process_schemas (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          schema_json TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Check if a unique index on (org_id) already exists before creating
      const existingIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='process_schemas'").all() as Array<{ name: string }>;
      if (!existingIndexes.some((i) => i.name === 'idx_process_schemas_active')) {
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_process_schemas_active ON process_schemas(org_id) WHERE is_active = 1;`);
      }

      // Create tasks if it still doesn't exist (fresh db that failed v1)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
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
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Create conversations tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
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
        CREATE INDEX IF NOT EXISTS idx_conversations_org_state ON conversations(org_id, state);
        CREATE INDEX IF NOT EXISTS idx_conversations_org_type ON conversations(org_id, type, state);
        CREATE INDEX IF NOT EXISTS idx_conversations_task ON conversations(task_id, state);
        CREATE INDEX IF NOT EXISTS idx_conversations_timeout ON conversations(timeout_at)
          WHERE state = 'waiting';

        CREATE TABLE IF NOT EXISTS conversation_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          author_role_id TEXT,
          author_type TEXT NOT NULL CHECK(author_type IN ('ai', 'human', 'system')),
          content TEXT NOT NULL,
          intent TEXT NOT NULL CHECK(intent IN ('question', 'reply', 'escalation', 'resolution', 'general')),
          in_reply_to_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_conv_messages_conversation ON conversation_messages(conversation_id, created_at);

        CREATE TABLE IF NOT EXISTS conversation_events (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_conv_events_conversation ON conversation_events(conversation_id, created_at);

        CREATE TABLE IF NOT EXISTS pending_wakes (
          id TEXT PRIMARY KEY,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Add columns that might be missing from the old organizations table
      const cols = db.pragma('table_info(organizations)') as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('planning_role_id')) {
        db.exec('ALTER TABLE organizations ADD COLUMN planning_role_id TEXT');
      }

      // Ensure tasks table has the 'depth' and 'artifact_paths' columns
      const taskCols = db.pragma('table_info(tasks)') as Array<{ name: string }>;
      const taskColNames = new Set(taskCols.map((c) => c.name));
      if (!taskColNames.has('depth')) {
        db.exec('ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0');
      }
      if (!taskColNames.has('artifact_paths')) {
        db.exec('ALTER TABLE tasks ADD COLUMN artifact_paths TEXT');
      }

      // Recreate runs table with new column names — drop old and create fresh
      // Old run history is not critical for the new architecture
      const tablesAfter = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      if (tablesAfter.some((t) => t.name === 'runs')) {
        const runCols = db.pragma('table_info(runs)') as Array<{ name: string }>;
        const runColNames = new Set(runCols.map((c) => c.name));
        if (!runColNames.has('conversation_id') || !runColNames.has('task_id') || !runColNames.has('wake_reason')) {
          // Drop old cost_entries that reference old runs, then drop runs
          db.exec('DELETE FROM cost_entries WHERE 1=1');
          db.exec('DROP TABLE IF EXISTS runs');
          db.exec(`
            CREATE TABLE runs (
              id TEXT PRIMARY KEY,
              org_id TEXT NOT NULL,
              task_id TEXT,
              conversation_id TEXT,
              role_id TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'queued',
              wake_reason TEXT NOT NULL DEFAULT 'manual',
              started_at TEXT,
              finished_at TEXT,
              cost_usd REAL NOT NULL DEFAULT 0,
              token_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);
        }
      } else {
        db.exec(`
          CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            task_id TEXT,
            conversation_id TEXT,
            role_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            wake_reason TEXT NOT NULL DEFAULT 'manual',
            started_at TEXT,
            finished_at TEXT,
            cost_usd REAL NOT NULL DEFAULT 0,
            token_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
      }

      // Ensure cost_entries exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS cost_entries (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          org_id TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Drop legacy tables that are no longer used
      db.exec('DROP TABLE IF EXISTS sessions');
      db.exec('DROP TABLE IF EXISTS session_messages');
    },
  },
  {
    version: 9,
    description: 'Add summary and error_message to runs table',
    up: (db) => {
      const cols = db.pragma('table_info(runs)') as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('summary')) {
        db.exec('ALTER TABLE runs ADD COLUMN summary TEXT');
      }
      if (!colNames.has('error_message')) {
        db.exec('ALTER TABLE runs ADD COLUMN error_message TEXT');
      }
    },
  },
  {
    version: 10,
    description: 'Add auto_start_on_create to organizations',
    up: (db) => {
      const cols = db.pragma('table_info(organizations)') as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('auto_start_on_create')) {
        db.exec('ALTER TABLE organizations ADD COLUMN auto_start_on_create INTEGER NOT NULL DEFAULT 1');
      }
    },
  },
];

export function runMigrations(db: Database.Database): void {
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
