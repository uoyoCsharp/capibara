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
    description: 'Greenfield baseline schema (consolidated single migration)',
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
          file_access_paths TEXT,
          tool_policy TEXT DEFAULT 'permissive',
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
          planning_mode TEXT NOT NULL DEFAULT 'preview'
            CHECK (planning_mode IN ('eager','preview')),
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
          type TEXT NOT NULL CHECK(type IN ('inquiry', 'planning', 'adhoc', 'plan_review')),
          state TEXT NOT NULL CHECK(state IN ('active', 'waiting', 'resolved', 'escalated', 'timed_out', 'cancelled', 'completed')),
          initiator_role_id TEXT NOT NULL,
          respondent_role_id TEXT,
          respondent_type TEXT CHECK(respondent_type IN ('ai', 'human')),
          task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
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
          status TEXT NOT NULL DEFAULT 'running'
            CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'suspended')),
          wake_reason TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          cost_usd REAL NOT NULL DEFAULT 0,
          token_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          error_message TEXT,
          acp_session_id TEXT,
          agent_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL)
        );

        CREATE UNIQUE INDEX idx_runs_active_per_role
          ON runs(role_id)
          WHERE status = 'running';

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
          conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (task_id IS NOT NULL OR conversation_id IS NOT NULL)
        );

        -- Idempotency: only one pending wake per natural key.
        -- COALESCE sentinel because SQLite treats NULLs as distinct in unique indexes.
        CREATE UNIQUE INDEX ux_pending_wakes_dedup
          ON pending_wakes(org_id, role_id, COALESCE(task_id, ''), COALESCE(conversation_id, ''), reason);

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

        -- ═══════════════════════════════════════════════
        -- 14. Pending Plan Trees (persistent preview/eager decomposition)
        -- ═══════════════════════════════════════════════
        CREATE TABLE pending_plan_trees (
          id TEXT PRIMARY KEY,
          root_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
          source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          role_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('preview', 'eager')),
          tree_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'approved', 'refining', 'discarded', 'expired')),
          pending_feedback TEXT,
          conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (
            (root_task_id IS NOT NULL AND source_conversation_id IS NULL)
            OR (root_task_id IS NULL AND source_conversation_id IS NOT NULL)
          )
        );

        -- Only one active/refining pending per root task (when task-anchored)
        CREATE UNIQUE INDEX idx_pending_plan_trees_active_task
          ON pending_plan_trees(root_task_id)
          WHERE status IN ('active', 'refining') AND root_task_id IS NOT NULL;

        -- Only one active/refining pending per source conversation
        CREATE UNIQUE INDEX idx_pending_plan_trees_active_conv
          ON pending_plan_trees(source_conversation_id)
          WHERE status IN ('active', 'refining') AND source_conversation_id IS NOT NULL;

        CREATE INDEX idx_pending_plan_trees_org ON pending_plan_trees(org_id, status);
        CREATE INDEX idx_pending_plan_trees_expires ON pending_plan_trees(expires_at)
          WHERE status IN ('active', 'refining');

        -- ═══════════════════════════════════════════════
        -- 15. File access audit log (ACP)
        -- ═══════════════════════════════════════════════
        CREATE TABLE file_access_log (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          path TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('read', 'write')),
          allowed INTEGER NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_file_access_log_session ON file_access_log(session_id);
        CREATE INDEX idx_file_access_log_role ON file_access_log(role_id, created_at);

        -- ═══════════════════════════════════════════════
        -- 16. Tool call audit log (ACP)
        -- ═══════════════════════════════════════════════
        CREATE TABLE tool_call_log (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          run_id TEXT,
          tool_call_id TEXT NOT NULL,
          title TEXT NOT NULL,
          kind TEXT,
          status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
          permission TEXT CHECK (permission IN ('allowed', 'rejected', 'not_requested')),
          raw_input TEXT,
          raw_output TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );

        CREATE INDEX idx_tool_call_log_session ON tool_call_log(session_id);
        CREATE INDEX idx_tool_call_log_run ON tool_call_log(run_id);

        -- ═══════════════════════════════════════════════
        -- 17. Session Suspensions (ACP)
        -- ═══════════════════════════════════════════════
        CREATE TABLE session_suspensions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          acp_session_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          org_id TEXT NOT NULL,
          task_id TEXT,
          aggregation_mode TEXT NOT NULL DEFAULT 'all'
            CHECK (aggregation_mode IN ('all', 'any')),
          status TEXT NOT NULL DEFAULT 'suspended'
            CHECK (status IN ('suspended', 'resumed', 'timed_out', 'cancelled')),
          parent_suspension_id TEXT REFERENCES session_suspensions(id),
          chain_depth INTEGER NOT NULL DEFAULT 0,
          suspended_at TEXT NOT NULL DEFAULT (datetime('now')),
          resumed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_session_suspensions_org ON session_suspensions(org_id, status);
        CREATE INDEX idx_session_suspensions_role ON session_suspensions(role_id, status);

        -- ═══════════════════════════════════════════════
        -- 18. Suspension Awaiting (inquiries being waited for)
        -- ═══════════════════════════════════════════════
        CREATE TABLE suspension_awaiting (
          id TEXT PRIMARY KEY,
          suspension_id TEXT NOT NULL REFERENCES session_suspensions(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL,
          respondent_role_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'in_progress', 'resolved', 'timed_out')),
          response TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_suspension_awaiting_suspension ON suspension_awaiting(suspension_id);
        CREATE INDEX idx_suspension_awaiting_conversation ON suspension_awaiting(conversation_id);

        -- ═══════════════════════════════════════════════
        -- 19. ACP Sessions — lean, persisted lifecycle record.
        -- The agent process remains the source of truth for session *history*
        -- (via session/load); only non-derivable lifecycle facts live here.
        -- cwd/mcpServers/allowedPaths/capabilities are re-derived on rebuild.
        -- ═══════════════════════════════════════════════
        CREATE TABLE acp_sessions (
          id TEXT PRIMARY KEY,
          acp_session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          org_id TEXT NOT NULL,
          run_id TEXT,
          conversation_id TEXT,
          task_id TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'suspended', 'closed', 'expired')),
          suspend_reason TEXT
            CHECK (suspend_reason IN ('idle', 'collaboration')),
          resume_strategy TEXT NOT NULL DEFAULT 'resume'
            CHECK (resume_strategy IN ('resume', 'load', 'rebuild')),
          resume_count INTEGER NOT NULL DEFAULT 0,
          last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          closed_at TEXT,
          close_reason TEXT
            CHECK (close_reason IN ('completed', 'user_closed', 'expired', 'error', 'cancelled', 'shutdown')),
          -- A suspended session always carries a reason (ADR-5: lifecycle/collaboration axes).
          CHECK (status != 'suspended' OR suspend_reason IS NOT NULL)
        );

        -- Resume/load lookups by agent-side id.
        CREATE INDEX idx_acp_sessions_acp_session_id ON acp_sessions(acp_session_id);
        -- Planning binding lookups (supersedes conversation.external_session_id truth).
        CREATE INDEX idx_acp_sessions_conversation ON acp_sessions(conversation_id);
        -- findResumable(roleId, orgId).
        CREATE INDEX idx_acp_sessions_role_org_status ON acp_sessions(role_id, org_id, status);
        -- Idle-TTL sweeper: status + suspend_reason + last_activity_at.
        CREATE INDEX idx_acp_sessions_idle_sweep ON acp_sessions(status, suspend_reason, last_activity_at);
      `);
    },
  },
  {
    version: 2,
    description: 'Add avatar support to roles (BLOB storage)',
    up: (db) => {
      db.exec(`
        -- Add avatar BLOB and MIME type columns to roles table
        -- Avatar is optional: NULL means no custom avatar (use default)
        ALTER TABLE roles ADD COLUMN avatar BLOB;
        ALTER TABLE roles ADD COLUMN avatar_mime_type TEXT;
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
