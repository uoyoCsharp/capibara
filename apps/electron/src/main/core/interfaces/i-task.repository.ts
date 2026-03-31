import type { TaskNode, TaskStatus, TaskType } from '../types/domain.types.js';

export interface CreateTaskInput {
  orgId: string;
  parentId: string | null;
  type: TaskType;
  title: string;
  description: string;
  assigneeRoleId: string | null;
  depth: number;
}

export interface ITaskRepository {
  findById(id: string): Promise<TaskNode | null>;
  findByParentId(parentId: string): Promise<TaskNode[]>;
  findByOrgId(orgId: string): Promise<TaskNode[]>;
  findByAssignee(roleId: string): Promise<TaskNode[]>;
  create(input: CreateTaskInput): Promise<TaskNode>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
  updateAssignee(id: string, roleId: string | null): Promise<void>;
  setArtifactPaths(id: string, paths: string[]): Promise<void>;
  delete(id: string): Promise<void>;
}
