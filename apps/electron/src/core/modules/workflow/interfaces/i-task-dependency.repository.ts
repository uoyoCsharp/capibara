import type { TaskDependency, CreateTaskDependencyInput } from '../types/workflow.types';

export interface ITaskDependencyRepository {
  findById(id: string): TaskDependency | null;
  findByDependentTaskId(taskId: string): TaskDependency[];
  findByDependencyTaskId(taskId: string): TaskDependency[];
  findByOrgId(orgId: string): TaskDependency[];
  create(input: CreateTaskDependencyInput): TaskDependency;
  deleteByDependentTaskId(taskId: string): void;
  deleteByDependencyTaskId(taskId: string): void;
  deleteByTaskId(taskId: string): void;
  hasUnresolvedDependencies(taskId: string, terminalStatuses?: string[]): boolean;
  canReach(fromTaskId: string, toTaskId: string): boolean;
}
