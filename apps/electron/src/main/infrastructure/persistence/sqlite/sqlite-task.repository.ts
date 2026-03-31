import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { TaskNode, TaskStatus } from '@main/core/types/domain.types.js';
import type { ITaskRepository, CreateTaskInput } from '@main/core/interfaces/i-task.repository.js';
import type { ISqliteConnection } from '@main/core/interfaces/i-sqlite-connection.js';
import { SQLITE_CONNECTION_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

interface TaskRow {
  id: string;
  org_id: string;
  parent_id: string | null;
  type: string;
  title: string;
  description: string;
  status: string;
  assignee_role_id: string | null;
  depth: number;
  artifact_paths: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: TaskRow): TaskNode {
  return {
    id: row.id,
    orgId: row.org_id,
    parentId: row.parent_id,
    type: row.type as TaskNode['type'],
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    assigneeRoleId: row.assignee_role_id,
    depth: row.depth,
    artifactPaths: row.artifact_paths ? (JSON.parse(row.artifact_paths) as string[]) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteTaskRepository implements ITaskRepository {
  constructor(
    @inject(SQLITE_CONNECTION_TOKEN) private readonly conn: ISqliteConnection,
  ) {}

  async findById(id: string): Promise<TaskNode | null> {
    const row = this.conn.getDb()
      .prepare('SELECT * FROM task_nodes WHERE id = ?')
      .get(id) as TaskRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findByParentId(parentId: string): Promise<TaskNode[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM task_nodes WHERE parent_id = ? ORDER BY created_at')
      .all(parentId) as TaskRow[];
    return rows.map(rowToEntity);
  }

  async findByOrgId(orgId: string): Promise<TaskNode[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM task_nodes WHERE org_id = ? ORDER BY depth, created_at')
      .all(orgId) as TaskRow[];
    return rows.map(rowToEntity);
  }

  async findByAssignee(roleId: string): Promise<TaskNode[]> {
    const rows = this.conn.getDb()
      .prepare('SELECT * FROM task_nodes WHERE assignee_role_id = ? ORDER BY created_at')
      .all(roleId) as TaskRow[];
    return rows.map(rowToEntity);
  }

  async create(input: CreateTaskInput): Promise<TaskNode> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.conn.getDb().prepare(`
      INSERT INTO task_nodes (id, org_id, parent_id, type, title, description, status, assignee_role_id, depth, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(id, input.orgId, input.parentId, input.type, input.title, input.description, input.assigneeRoleId, input.depth, now, now);

    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE task_nodes SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    if (changes.changes === 0) throw new NotFoundError('TaskNode', id);
  }

  async updateAssignee(id: string, roleId: string | null): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE task_nodes SET assignee_role_id = ?, updated_at = ? WHERE id = ?')
      .run(roleId, now, id);
    if (changes.changes === 0) throw new NotFoundError('TaskNode', id);
  }

  async setArtifactPaths(id: string, paths: string[]): Promise<void> {
    const now = new Date().toISOString();
    const changes = this.conn.getDb()
      .prepare('UPDATE task_nodes SET artifact_paths = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(paths), now, id);
    if (changes.changes === 0) throw new NotFoundError('TaskNode', id);
  }

  async delete(id: string): Promise<void> {
    const changes = this.conn.getDb()
      .prepare('DELETE FROM task_nodes WHERE id = ?')
      .run(id);
    if (changes.changes === 0) throw new NotFoundError('TaskNode', id);
  }
}
