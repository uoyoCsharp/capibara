import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema — all tables',
    up: (db) => {
      db.exec(`
        -- ═══════════════════════════════════════════════
        -- 1. Organizations
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
          budget_limit REAL NOT NULL DEFAULT 50.0,
          org_template_id TEXT,
          workspace_path TEXT NOT NULL DEFAULT '',
          custom_instructions TEXT NOT NULL DEFAULT '',
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
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'idle')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 4. Task Nodes
        -- ═══════════════════════════════════════════════
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

        -- ═══════════════════════════════════════════════
        -- 5. Skills
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
        -- 6. Discussion Groups & Messages
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS discussion_groups (
          id TEXT PRIMARY KEY,
          task_node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
          summary TEXT,
          last_summary_at TEXT,
          current_round INTEGER NOT NULL DEFAULT 1,
          revise_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS discussion_messages (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES discussion_groups(id) ON DELETE CASCADE,
          author_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
          author_type TEXT NOT NULL CHECK (author_type IN ('ai', 'human', 'system')),
          content TEXT NOT NULL,
          vote_tag TEXT CHECK (vote_tag IN ('APPROVE', 'REVISE', 'CONCERN', 'DELEGATE') OR vote_tag IS NULL),
          review_round INTEGER NOT NULL DEFAULT 1,
          metadata TEXT,
          intent TEXT NOT NULL DEFAULT 'general'
            CHECK(intent IN ('question', 'reply', 'escalation', 'resolution', 'vote', 'general')),
          in_reply_to_message_id TEXT REFERENCES discussion_messages(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 7. Runs
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          task_node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
          trigger TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          cost_usd REAL NOT NULL DEFAULT 0,
          token_count INTEGER NOT NULL DEFAULT 0,
          session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 8. Cost Entries
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
        -- 9. Narratives
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS narratives (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          template_data TEXT NOT NULL DEFAULT '{}',
          rendered_text TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 10. Pending Wakes
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS pending_wakes (
          id TEXT PRIMARY KEY,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          trigger TEXT NOT NULL,
          task_node_id TEXT REFERENCES task_nodes(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ═══════════════════════════════════════════════
        -- 11. Conversation Workflows
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS conversation_workflows (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          task_node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
          discussion_group_id TEXT NOT NULL REFERENCES discussion_groups(id) ON DELETE CASCADE,
          asking_role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          asking_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          asking_session_id TEXT,
          question_message_id TEXT NOT NULL REFERENCES discussion_messages(id) ON DELETE CASCADE,
          reply_message_id TEXT REFERENCES discussion_messages(id) ON DELETE SET NULL,
          respondent_role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
          respondent_type TEXT NOT NULL CHECK(respondent_type IN ('ai', 'human')),
          state TEXT NOT NULL CHECK(state IN (
            'waiting_for_reply', 'reply_received', 'resumed',
            'resolved', 'escalated', 'timed_out', 'cancelled'
          )),
          depth INTEGER NOT NULL DEFAULT 0,
          parent_workflow_id TEXT REFERENCES conversation_workflows(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          timeout_at TEXT,
          resolved_at TEXT,
          audit_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_conv_wf_org_state ON conversation_workflows(org_id, state);
        CREATE INDEX idx_conv_wf_task ON conversation_workflows(task_node_id, state);
        CREATE INDEX idx_conv_wf_asking_role ON conversation_workflows(asking_role_id, state);
        CREATE INDEX idx_conv_wf_respondent ON conversation_workflows(respondent_role_id, state);
        CREATE INDEX idx_conv_wf_timeout ON conversation_workflows(timeout_at)
          WHERE state = 'waiting_for_reply';

        -- ═══════════════════════════════════════════════
        -- 12. Conversation Events (append-only audit log)
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS conversation_events (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL REFERENCES conversation_workflows(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_conv_events_workflow ON conversation_events(workflow_id, created_at);
      `);
    },
  },
  {
    version: 2,
    description: 'Add custom_instructions column to organizations',
    up: (db) => {
      // Check if column already exists (covers fresh installs where v1 already has it)
      const cols = db.prepare("PRAGMA table_info('organizations')").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'custom_instructions')) {
        db.exec(`ALTER TABLE organizations ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''`);
      }
    },
  },
  {
    version: 3,
    description: 'Add workflow_schemas table and remove task_nodes CHECK constraints',
    up: (db) => {
      db.exec(`
        -- ═══════════════════════════════════════════════
        -- 13. Workflow Schemas
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS workflow_schemas (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          schema_json TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(org_id, is_active)
        );
      `);

      // Recreate task_nodes without CHECK constraints on type and status.
      // SQLite does not support DROP CONSTRAINT, so we recreate the table.
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_nodes_new (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES task_nodes_new(id) ON DELETE SET NULL,
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

        INSERT INTO task_nodes_new SELECT * FROM task_nodes;
        DROP TABLE task_nodes;
        ALTER TABLE task_nodes_new RENAME TO task_nodes;
      `);
    },
  },
  {
    version: 4,
    description: 'Add is_system_role to roles and planning_role_id to organizations',
    up: (db) => {
      const roleCols = db.prepare("PRAGMA table_info('roles')").all() as Array<{ name: string }>;
      if (!roleCols.some((c) => c.name === 'is_system_role')) {
        db.exec(`ALTER TABLE roles ADD COLUMN is_system_role INTEGER NOT NULL DEFAULT 0`);
      }
      const orgCols = db.prepare("PRAGMA table_info('organizations')").all() as Array<{ name: string }>;
      if (!orgCols.some((c) => c.name === 'planning_role_id')) {
        db.exec(`ALTER TABLE organizations ADD COLUMN planning_role_id TEXT DEFAULT NULL`);
      }
    },
  },
  {
    version: 5,
    description: 'Add sessions and session_messages tables',
    up: (db) => {
      db.exec(`
        -- ═══════════════════════════════════════════════
        -- 14. Sessions (human-AI conversations)
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('planning', 'adhoc')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
          cli_session_id TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_sessions_org_status ON sessions(org_id, status);
        CREATE INDEX idx_sessions_org_type ON sessions(org_id, type, status);

        -- Enforce at most one active session per org+type at DB level
        CREATE UNIQUE INDEX idx_sessions_unique_active
          ON sessions(org_id, type) WHERE status = 'active';

        -- ═══════════════════════════════════════════════
        -- 15. Session Messages
        -- ═══════════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS session_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          author_type TEXT NOT NULL CHECK(author_type IN ('human', 'ai', 'system')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_session_messages_session ON session_messages(session_id, created_at);
      `);
    },
  },
  {
    version: 6,
    description: 'Make runs.task_node_id nullable and add session reference',
    up: (db) => {
      // SQLite does not support ALTER COLUMN, so recreate the table
      db.exec(`
        CREATE TABLE IF NOT EXISTS runs_new (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          task_node_id TEXT REFERENCES task_nodes(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
          trigger TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          cost_usd REAL NOT NULL DEFAULT 0,
          token_count INTEGER NOT NULL DEFAULT 0,
          session_id TEXT,
          run_session_id TEXT REFERENCES sessions(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO runs_new (id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, cost_usd, token_count, session_id, created_at)
          SELECT id, org_id, task_node_id, role_id, status, trigger, started_at, finished_at, cost_usd, token_count, session_id, created_at FROM runs;

        DROP TABLE runs;
        ALTER TABLE runs_new RENAME TO runs;
      `);
    },
  },
  {
    version: 7,
    description: 'Close legacy planning tasks now that sessions handle planning',
    up: (db) => {
      // Mark all non-terminal 'plan' type tasks as 'done' so they don't
      // block new session-based planning. Safe: plan tasks used a hardcoded
      // 'done' terminal status, not schema-driven.
      db.exec(`
        UPDATE task_nodes SET status = 'done', updated_at = datetime('now')
        WHERE type = 'plan' AND status != 'done';
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
