import type { Task, CreateTaskInput, BatchCreateTaskInput, TaskDependency, CreateTaskDependencyInput } from '../types/workflow.types';

/**
 * Interface for TaskService — the primary service for task lifecycle management.
 * Cross-module callers depend on this interface; composition-root binds the concrete.
 */
export interface ITaskService {
  findById(id: string): Task | null;
  findByOrgId(orgId: string): Task[];
  findChildren(parentId: string): Task[];
  hasChildren(parentId: string): boolean;
  getAncestors(taskId: string): Task[];
  create(input: CreateTaskInput): Task;
  batchCreate(orgId: string, parentId: string | null, items: BatchCreateTaskInput[]): Task[];
  delete(id: string): void;
  addDependency(input: CreateTaskDependencyInput): TaskDependency;
  removeDependency(dependencyId: string): void;
  getDependencies(taskId: string): TaskDependency[];
  getDependents(taskId: string): TaskDependency[];
}
