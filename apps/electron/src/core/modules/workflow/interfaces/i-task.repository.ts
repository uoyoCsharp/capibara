import type { Task, CreateTaskInput, TaskStatus, TaskPausedReason } from '../types/workflow.types';

export interface ITaskRepository {
  findById(id: string): Task | null;
  findByOrgId(orgId: string): Task[];
  findChildren(parentId: string): Task[];
  hasChildren(parentId: string): boolean;
  findByAssigneeRoleId(roleId: string): Task[];
  create(input: CreateTaskInput, depth: number): Task;
  updateStatus(id: string, status: TaskStatus): void;
  updatePausedReason(id: string, reason: TaskPausedReason): void;
  update(id: string, fields: Partial<Pick<Task, 'title' | 'description' | 'assigneeRoleId' | 'artifactPaths'>>): Task;
  delete(id: string): void;
}
