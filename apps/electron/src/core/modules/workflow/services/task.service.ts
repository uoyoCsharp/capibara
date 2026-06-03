import { injectable } from 'tsyringe';
import type { ITaskService } from '../interfaces/i-task.service';
import type { ITaskRepository } from '../interfaces/i-task.repository';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import { ValidationError, NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { IProcessEngine } from '../interfaces/i-process.engine';
import type { Task, CreateTaskInput, BatchCreateTaskInput } from '../types/workflow.types';

@injectable()
export class TaskService implements ITaskService {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: IProcessEngine,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  findById(id: string): Task | null {
    return this.taskRepo.findById(id);
  }

  findByOrgId(orgId: string): Task[] {
    return this.taskRepo.findByOrgId(orgId);
  }

  findChildren(parentId: string): Task[] {
    return this.taskRepo.findChildren(parentId);
  }

  hasChildren(parentId: string): boolean {
    return this.taskRepo.hasChildren(parentId);
  }

  getAncestors(taskId: string): Task[] {
    const ancestors: Task[] = [];
    let current = this.taskRepo.findById(taskId);
    while (current?.parentId) {
      const parent = this.taskRepo.findById(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  create(input: CreateTaskInput): Task {
    let depth = 0;

    if (input.parentId) {
      const parent = this.taskRepo.findById(input.parentId);
      if (!parent) throw new NotFoundError('Task (parent)', input.parentId);
      depth = parent.depth + 1;

      if (!this.processEngine.validateChildType(input.orgId, parent.type, input.type)) {
        throw new ValidationError(`Type '${input.type}' not allowed as child of '${parent.type}'`);
      }
    }

    if (!this.processEngine.validateType(input.orgId, input.type)) {
      throw new ValidationError(`Unknown task type: ${input.type}`);
    }

    if (input.planningMode) {
      const typeDef = this.processEngine.getWorkItemType(input.orgId, input.type);
      if (!typeDef?.canDecompose) {
        throw new ValidationError(
          `INVALID_PLANNING_MODE_FOR_TYPE: type '${input.type}' does not support planningMode '${input.planningMode}'`,
        );
      }
    }

    const task = this.taskRepo.create(input, depth);
    this.eventPublisher.publish('task:created', {
      taskId: task.id,
      orgId: task.orgId,
      type: task.type,
      parentId: task.parentId,
    });
    return task;
  }

  batchCreate(orgId: string, parentId: string | null, items: BatchCreateTaskInput[]): Task[] {
    const created: Task[] = [];
    for (const item of items) {
      const task = this.create({
        orgId,
        parentId,
        type: item.type,
        title: item.title,
        description: item.description,
        assigneeRoleId: item.assigneeRoleId,
      });
      created.push(task);

      if (item.children && item.children.length > 0) {
        const childTasks = this.batchCreate(orgId, task.id, item.children);
        created.push(...childTasks);
      }
    }
    return created;
  }

  delete(id: string): void {
    const children = this.taskRepo.findChildren(id);
    for (const child of children) {
      this.delete(child.id);
    }

    this.taskRepo.delete(id);
  }
}
