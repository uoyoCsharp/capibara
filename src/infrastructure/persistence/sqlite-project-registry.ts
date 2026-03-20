/**
 * SQLite Project Registry - IProjectRegistry implementation backed by SQLite
 * @module infrastructure/persistence/sqlite-project-registry
 */

import type { IProjectRegistry } from '../../core/interfaces/project-registry.interface.js';
import type { Project, ProjectInput } from '../../core/types/project.types.js';
import type { SqliteStore } from './sqlite-store.js';

interface ProjectRow {
  id: string;
  name: string;
  project_dir: string;
  config: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    projectDir: row.project_dir,
    config: JSON.parse(row.config),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProjectRegistry implements IProjectRegistry {
  constructor(private store: SqliteStore) {}

  async add(input: ProjectInput): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Auto-activate if this is the first project
    const count = (this.store.db.prepare('SELECT COUNT(*) as cnt FROM projects').get() as { cnt: number }).cnt;
    const isActive = count === 0 ? 1 : 0;

    this.store.db.prepare(`
      INSERT INTO projects (id, name, project_dir, config, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.projectDir, JSON.stringify(input.config ?? {}), isActive, now, now);

    return (await this.get(id))!;
  }

  async get(id: string): Promise<Project | null> {
    const row = this.store.db.prepare(
      'SELECT * FROM projects WHERE id = ?',
    ).get(id) as ProjectRow | undefined;

    return row ? rowToProject(row) : null;
  }

  async list(): Promise<Project[]> {
    const rows = this.store.db.prepare(
      'SELECT * FROM projects ORDER BY created_at ASC',
    ).all() as ProjectRow[];

    return rows.map(rowToProject);
  }

  async update(id: string, patch: Partial<ProjectInput>): Promise<Project> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Project not found: ${id}`);

    const now = new Date().toISOString();
    const name = patch.name ?? existing.name;
    const projectDir = patch.projectDir ?? existing.projectDir;
    const config = patch.config !== undefined
      ? JSON.stringify(patch.config)
      : JSON.stringify(existing.config);

    this.store.db.prepare(`
      UPDATE projects SET name = ?, project_dir = ?, config = ?, updated_at = ?
      WHERE id = ?
    `).run(name, projectDir, config, now, id);

    return (await this.get(id))!;
  }

  async remove(id: string): Promise<void> {
    this.store.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  async getActive(): Promise<Project | null> {
    const row = this.store.db.prepare(
      'SELECT * FROM projects WHERE is_active = 1',
    ).get() as ProjectRow | undefined;

    return row ? rowToProject(row) : null;
  }

  async setActive(id: string): Promise<Project> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Project not found: ${id}`);

    const now = new Date().toISOString();

    this.store.db.transaction(() => {
      this.store.db.prepare('UPDATE projects SET is_active = 0, updated_at = ? WHERE is_active = 1').run(now);
      this.store.db.prepare('UPDATE projects SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
    })();

    return (await this.get(id))!;
  }
}
