import type { Task, CreateTaskInput, TaskStatus } from '../types/workflow.types';

export interface ITaskRepository {
  findById(id: string): Task | null;
  findByOrgId(orgId: string): Task[];
  findChildren(parentId: string): Task[];
  findByAssigneeRoleId(roleId: string): Task[];
  create(input: CreateTaskInput, depth: number): Task;
  updateStatus(id: string, status: TaskStatus): void;
  update(id: string, fields: Partial<Pick<Task, 'title' | 'description' | 'assigneeRoleId' | 'artifactPaths'>>): Task;
  delete(id: string): void;
}
