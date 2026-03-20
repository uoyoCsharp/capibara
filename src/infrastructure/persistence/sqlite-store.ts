/**
 * SQLite Store - Central database connection and schema migration manager
 * @module infrastructure/persistence/sqlite-store
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    project_dir TEXT NOT NULL,
    config      TEXT NOT NULL DEFAULT '{}',
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active
    ON projects (is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS requirements (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    source      TEXT NOT NULL DEFAULT 'manual',
    priority    INTEGER NOT NULL DEFAULT 0,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requirements_project_status
    ON requirements (project_id, status, priority DESC, created_at ASC);
`;

let instance: SqliteStore | null = null;

export class SqliteStore {
  readonly db: Database.Database;

  constructor(dbPath?: string) {
    const dir = join(homedir(), '.capibara');
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath ?? join(dir, 'capibara.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SCHEMA_V1);
  }

  close(): void {
    this.db.close();
    if (instance === this) instance = null;
  }

  /** Get or create the shared singleton instance */
  static shared(dbPath?: string): SqliteStore {
    if (!instance) {
      instance = new SqliteStore(dbPath);
    }
    return instance;
  }
}
