/**
 * SQLite Requirement Pool - IRequirementPool implementation backed by SQLite
 * @module infrastructure/persistence/sqlite-requirement-pool
 */

import type { IRequirementPool } from '../../core/interfaces/requirement-pool.interface.js';
import type {
  Requirement,
  RequirementInput,
  RequirementStatus,
} from '../../core/types/requirement.types.js';
import type { SqliteStore } from './sqlite-store.js';

interface RequirementRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  source: string;
  priority: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as RequirementStatus,
    source: row.source as Requirement['source'],
    priority: row.priority,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteRequirementPool implements IRequirementPool {
  constructor(private store: SqliteStore) {}

  async add(projectId: string, input: RequirementInput): Promise<Requirement> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.store.db
      .prepare(
        `
      INSERT INTO requirements (id, project_id, title, description, status, source, priority, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        projectId,
        input.title,
        input.description,
        input.source ?? 'manual',
        input.priority ?? 0,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );

    return (await this.get(id))!;
  }

  async get(id: string): Promise<Requirement | null> {
    const row = this.store.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as
      | RequirementRow
      | undefined;

    return row ? rowToRequirement(row) : null;
  }

  async list(projectId: string, filter?: { status?: RequirementStatus }): Promise<Requirement[]> {
    if (filter?.status) {
      const rows = this.store.db
        .prepare(
          'SELECT * FROM requirements WHERE project_id = ? AND status = ? ORDER BY priority DESC, created_at ASC',
        )
        .all(projectId, filter.status) as RequirementRow[];
      return rows.map(rowToRequirement);
    }

    const rows = this.store.db
      .prepare(
        'SELECT * FROM requirements WHERE project_id = ? ORDER BY priority DESC, created_at ASC',
      )
      .all(projectId) as RequirementRow[];
    return rows.map(rowToRequirement);
  }

  async update(
    id: string,
    patch: Partial<Pick<Requirement, 'title' | 'description' | 'status' | 'priority'>>,
  ): Promise<Requirement> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Requirement not found: ${id}`);

    const now = new Date().toISOString();
    const title = patch.title ?? existing.title;
    const description = patch.description ?? existing.description;
    const status = patch.status ?? existing.status;
    const priority = patch.priority ?? existing.priority;

    this.store.db
      .prepare(
        `
      UPDATE requirements SET title = ?, description = ?, status = ?, priority = ?, updated_at = ?
      WHERE id = ?
    `,
      )
      .run(title, description, status, priority, now, id);

    return (await this.get(id))!;
  }

  async remove(id: string): Promise<void> {
    this.store.db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
  }

  async nextPending(projectId: string): Promise<Requirement | null> {
    const row = this.store.db
      .prepare(
        `
      SELECT * FROM requirements
      WHERE project_id = ? AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `,
      )
      .get(projectId) as RequirementRow | undefined;

    return row ? rowToRequirement(row) : null;
  }
}
