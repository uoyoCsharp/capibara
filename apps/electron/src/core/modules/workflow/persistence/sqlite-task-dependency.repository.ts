import { randomUUID } from 'node:crypto';
import { injectable } from 'tsyringe';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { ITaskDependencyRepository } from '../interfaces/i-task-dependency.repository';
import type { TaskDependency, CreateTaskDependencyInput } from '../types/workflow.types';

interface DependencyRow {
  id: string;
  org_id: string;
  dependent_task_id: string;
  dependency_task_id: string;
  created_at: string;
}

function toDependency(row: DependencyRow): TaskDependency {
  return {
    id: row.id,
    orgId: row.org_id,
    dependentTaskId: row.dependent_task_id,
    dependencyTaskId: row.dependency_task_id,
    createdAt: row.created_at,
  };
}

@injectable()
export class SqliteTaskDependencyRepository implements ITaskDependencyRepository {
  constructor(private readonly connection: ISqliteConnection) {}

  findById(id: string): TaskDependency | null {
    const row = this.connection.getDb()
      .prepare('SELECT * FROM task_dependencies WHERE id = ?')
      .get(id) as DependencyRow | undefined;
    return row ? toDependency(row) : null;
  }

  findByDependentTaskId(taskId: string): TaskDependency[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM task_dependencies WHERE dependent_task_id = ? ORDER BY created_at')
      .all(taskId) as DependencyRow[];
    return rows.map(toDependency);
  }

  findByDependencyTaskId(taskId: string): TaskDependency[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM task_dependencies WHERE dependency_task_id = ? ORDER BY created_at')
      .all(taskId) as DependencyRow[];
    return rows.map(toDependency);
  }

  findByOrgId(orgId: string): TaskDependency[] {
    const rows = this.connection.getDb()
      .prepare('SELECT * FROM task_dependencies WHERE org_id = ? ORDER BY created_at')
      .all(orgId) as DependencyRow[];
    return rows.map(toDependency);
  }

  create(input: CreateTaskDependencyInput): TaskDependency {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.connection.getDb()
      .prepare(
        'INSERT INTO task_dependencies (id, org_id, dependent_task_id, dependency_task_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.orgId, input.dependentTaskId, input.dependencyTaskId, now);
    return this.findById(id)!;
  }

  deleteByDependentTaskId(taskId: string): void {
    this.connection.getDb()
      .prepare('DELETE FROM task_dependencies WHERE dependent_task_id = ?')
      .run(taskId);
  }

  deleteByDependencyTaskId(taskId: string): void {
    this.connection.getDb()
      .prepare('DELETE FROM task_dependencies WHERE dependency_task_id = ?')
      .run(taskId);
  }

  deleteByTaskId(taskId: string): void {
    this.connection.getDb()
      .prepare('DELETE FROM task_dependencies WHERE dependent_task_id = ? OR dependency_task_id = ?')
      .run(taskId, taskId);
  }

  hasUnresolvedDependencies(taskId: string, terminalStatuses: string[] = ['done', 'cancelled']): boolean {
    const placeholders = terminalStatuses.map(() => '?').join(', ');
    const row = this.connection.getDb()
      .prepare(`
        SELECT 1 FROM task_dependencies td
        JOIN tasks t ON td.dependency_task_id = t.id
        WHERE td.dependent_task_id = ?
        AND t.status NOT IN (${placeholders})
        LIMIT 1
      `)
      .get(taskId, ...terminalStatuses) as { 1: number } | undefined;
    return row !== undefined;
  }

  canReach(fromTaskId: string, toTaskId: string): boolean {
    if (fromTaskId === toTaskId) return true;

    const db = this.connection.getDb();
    const visited = new Set<string>();
    const queue: string[] = [fromTaskId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const rows = db
        .prepare('SELECT dependency_task_id FROM task_dependencies WHERE dependent_task_id = ?')
        .all(current) as { dependency_task_id: string }[];

      for (const row of rows) {
        if (row.dependency_task_id === toTaskId) return true;
        if (!visited.has(row.dependency_task_id)) {
          queue.push(row.dependency_task_id);
        }
      }
    }

    return false;
  }
}
