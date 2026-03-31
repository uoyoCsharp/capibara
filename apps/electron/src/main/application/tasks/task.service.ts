import { injectable, inject } from 'tsyringe';
import type { ITaskRepository, CreateTaskInput } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { TaskNode, TaskStatus } from '@main/core/types/domain.types.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';
import { NotFoundError, ValidationError } from '@main/core/errors/capibara.errors.js';
import { TaskStateMachine } from '../state-machine/task.state-machine.js';

@injectable()
export class TaskService {
  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    private readonly stateMachine: TaskStateMachine,
  ) {}

  async findById(id: string): Promise<TaskNode | null> {
    return this.taskRepo.findById(id);
  }

  async findByOrgId(orgId: string): Promise<TaskNode[]> {
    return this.taskRepo.findByOrgId(orgId);
  }

  async findChildren(parentId: string): Promise<TaskNode[]> {
    return this.taskRepo.findByParentId(parentId);
  }

  async create(input: {
    orgId: string;
    parentId: string | null;
    type: TaskNode['type'];
    title: string;
    description: string;
    assigneeRoleId: string | null;
  }): Promise<TaskNode> {
    if (!input.title.trim()) {
      throw new ValidationError('Task title is required');
    }

    // Validate assignee exists
    if (input.assigneeRoleId) {
      const role = await this.roleRepo.findById(input.assigneeRoleId);
      if (!role) {
        throw new NotFoundError('Role', input.assigneeRoleId);
      }
    }

    // Calculate depth from parent
    let depth = 0;
    if (input.parentId) {
      const parent = await this.taskRepo.findById(input.parentId);
      if (!parent) {
        throw new NotFoundError('TaskNode (parent)', input.parentId);
      }
      depth = parent.depth + 1;
    }

    const createInput: CreateTaskInput = {
      orgId: input.orgId,
      parentId: input.parentId,
      type: input.type,
      title: input.title,
      description: input.description,
      assigneeRoleId: input.assigneeRoleId,
      depth,
    };

    const task = await this.taskRepo.create(createInput);
    this.logger.info('Task created', { taskId: task.id, type: task.type, depth });

    this.eventBus.emit({
      type: 'task:created',
      timestamp: new Date().toISOString(),
      payload: { taskId: task.id, orgId: task.orgId, type: task.type, parentId: task.parentId },
    });

    return task;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.stateMachine.transition(taskId, status);

    // Check for auto-propagation when task reaches done/approved
    if (status === 'done' || status === 'approved') {
      await this.checkAutoPropagate(taskId);
    }
  }

  async delete(taskId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError('TaskNode', taskId);
    }

    // Delete children first (recursive)
    const children = await this.taskRepo.findByParentId(taskId);
    for (const child of children) {
      await this.delete(child.id);
    }

    await this.taskRepo.delete(taskId);
    this.logger.info('Task deleted', { taskId });
  }

  private async checkAutoPropagate(taskId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task || !task.parentId) return;

    const siblings = await this.taskRepo.findByParentId(task.parentId);
    const allComplete = siblings.every(
      (s) => s.status === 'done' || s.status === 'approved' || s.status === 'cancelled',
    );

    if (allComplete) {
      this.logger.info('All children complete, emitting propagation event', {
        parentId: task.parentId,
      });
      this.eventBus.emit({
        type: 'task:completed',
        timestamp: new Date().toISOString(),
        payload: {
          taskId: task.parentId,
          orgId: task.orgId,
          allChildrenComplete: true,
        },
      });
    }
  }
}
