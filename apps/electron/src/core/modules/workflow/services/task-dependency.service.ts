import { injectable } from 'tsyringe';
import type { ITaskDependencyRepository } from '../interfaces/i-task-dependency.repository';
import type { ITaskRepository } from '../interfaces/i-task.repository';
import type { TaskDependency, CreateTaskDependencyInput } from '../types/workflow.types';
import { ValidationError } from '@core/foundation/errors/capibara.errors';

@injectable()
export class TaskDependencyService {
  constructor(
    private readonly dependencyRepo: ITaskDependencyRepository,
    private readonly taskRepo: ITaskRepository,
  ) {}

  addDependency(input: CreateTaskDependencyInput): TaskDependency {
    if (input.dependentTaskId === input.dependencyTaskId) {
      throw new ValidationError('A task cannot depend on itself');
    }

    if (this.dependencyRepo.canReach(input.dependencyTaskId, input.dependentTaskId)) {
      throw new ValidationError(
        `Circular dependency detected: adding ${input.dependentTaskId} -> ${input.dependencyTaskId} would create a cycle`,
      );
    }

    const dependentTask = this.taskRepo.findById(input.dependentTaskId);
    if (!dependentTask) {
      throw new ValidationError(`Dependent task not found: ${input.dependentTaskId}`);
    }

    const dependencyTask = this.taskRepo.findById(input.dependencyTaskId);
    if (!dependencyTask) {
      throw new ValidationError(`Dependency task not found: ${input.dependencyTaskId}`);
    }

    if (dependentTask.orgId !== input.orgId || dependencyTask.orgId !== input.orgId) {
      throw new ValidationError('Dependencies must be within the same organization');
    }

    const existing = this.dependencyRepo.findByDependentTaskId(input.dependentTaskId);
    if (existing.some((d) => d.dependencyTaskId === input.dependencyTaskId)) {
      throw new ValidationError(
        `Dependency already exists: ${input.dependentTaskId} -> ${input.dependencyTaskId}`,
      );
    }

    return this.dependencyRepo.create(input);
  }

  removeDependency(dependencyId: string): void {
    const dep = this.dependencyRepo.findById(dependencyId);
    if (!dep) {
      throw new ValidationError(`Dependency not found: ${dependencyId}`);
    }
    this.dependencyRepo.deleteByDependentTaskId(dep.dependentTaskId);
    this.dependencyRepo.deleteByDependencyTaskId(dep.dependencyTaskId);
  }

  getDependencies(taskId: string): TaskDependency[] {
    return this.dependencyRepo.findByDependentTaskId(taskId);
  }

  getDependents(taskId: string): TaskDependency[] {
    return this.dependencyRepo.findByDependencyTaskId(taskId);
  }

  getDependenciesByOrgId(orgId: string): TaskDependency[] {
    return this.dependencyRepo.findByOrgId(orgId);
  }
}
