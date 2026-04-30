import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import { NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { ITaskRepository } from '../interfaces/i-task.repository';
import type { Task, CreateTaskInput, TaskStatus, TaskPausedReason, PlanningMode } from '../types/workflow.types';

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
  paused_reason: string | null;
  planning_mode: string;
  created_at: string;
  updated_at: string;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    orgId: row.org_id,
    parentId: row.parent_id,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeRoleId: row.assignee_role_id,
    depth: row.depth,
    artifactPaths: row.artifact_paths ? (JSON.parse(row.artifact_paths) as string[]) : null,
    pausedReason: row.paused_reason as TaskPausedReason,
    planningMode: row.planning_mode as PlanningMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteTaskRepository implements ITaskRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): Task | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  findByOrgId(orgId: string): Task[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM tasks WHERE org_id = ? ORDER BY depth, created_at')
      .all(orgId) as TaskRow[];
    return rows.map(toTask);
  }

  findChildren(parentId: string): Task[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at')
      .all(parentId) as TaskRow[];
    return rows.map(toTask);
  }

  findByAssigneeRoleId(roleId: string): Task[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM tasks WHERE assignee_role_id = ? ORDER BY created_at')
      .all(roleId) as TaskRow[];
    return rows.map(toTask);
  }

  create(input: CreateTaskInput, depth: number): Task {
    const id = randomUUID();
    const now = new Date().toISOString();
    const planningMode: PlanningMode = input.planningMode ?? 'layered';
    this.connection.getDb()
      .prepare(`
        INSERT INTO tasks (id, org_id, parent_id, type, title, description, status, assignee_role_id, depth, planning_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `)
      .run(id, input.orgId, input.parentId, input.type, input.title, input.description, input.assigneeRoleId, depth, planningMode, now, now);
    return this.findById(id)!;
  }

  updateStatus(id: string, status: TaskStatus): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
  }

  updatePausedReason(id: string, reason: TaskPausedReason): void {
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare('UPDATE tasks SET paused_reason = ?, updated_at = ? WHERE id = ?')
      .run(reason, now, id);
  }

  update(id: string, fields: Partial<Pick<Task, 'title' | 'description' | 'assigneeRoleId' | 'artifactPaths'>>): Task {
    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (fields.title !== undefined) { setClauses.push('title = ?'); values.push(fields.title); }
    if (fields.description !== undefined) { setClauses.push('description = ?'); values.push(fields.description); }
    if (fields.assigneeRoleId !== undefined) { setClauses.push('assignee_role_id = ?'); values.push(fields.assigneeRoleId); }
    if (fields.artifactPaths !== undefined) { setClauses.push('artifact_paths = ?'); values.push(fields.artifactPaths ? JSON.stringify(fields.artifactPaths) : null); }

    values.push(id);
    this.connection.getDb()
      .prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...values);

    const result = this.findById(id);
    if (!result) throw new NotFoundError('Task', id);
    return result;
  }

  delete(id: string): void {
    const info = this.connection.getDb()
      .prepare('DELETE FROM tasks WHERE id = ?')
      .run(id);
    if (info.changes === 0) throw new NotFoundError('Task', id);
  }
}
