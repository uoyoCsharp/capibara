import { injectable } from 'tsyringe';
import type { ITaskRepository } from '../interfaces/i-task.repository';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventType } from '@core/foundation/events';
import { TaskStateError, NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { ProcessEngine } from './process.engine';
import type { Task, TaskStatus } from '../types/workflow.types';

@injectable()
export class TaskStateMachine {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: ProcessEngine,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  transition(taskId: string, newStatus: TaskStatus): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new NotFoundError('Task', taskId);

    const currentStatus = task.status;
    if (currentStatus === newStatus) return task;

    this.logger.debug('Task transition attempt', { taskId, from: currentStatus, to: newStatus, orgId: task.orgId });

    if (!this.processEngine.validateTransition(task.orgId, currentStatus, newStatus)) {
      this.logger.debug('Task transition rejected', { taskId, from: currentStatus, to: newStatus });
      throw new TaskStateError(currentStatus, newStatus);
    }

    this.taskRepo.updateStatus(taskId, newStatus);

    const category = this.processEngine.getStatusCategory(task.orgId, newStatus);
    this.logger.debug('Task transition completed', { taskId, from: currentStatus, to: newStatus, category });

    if (category === 'approval') {
      this.emitEvent('task:entered-approval', { taskId, orgId: task.orgId, from: currentStatus, to: newStatus });
    } else {
      this.emitEvent('task:status-changed', { taskId, orgId: task.orgId, from: currentStatus, to: newStatus, assigneeRoleId: task.assigneeRoleId });
    }

    if (category === 'terminal') {
      this.emitEvent('task:completed', { taskId, orgId: task.orgId, status: newStatus });
    }

    return this.taskRepo.findById(taskId)!;
  }

  confirmApproval(taskId: string, nextStatus: TaskStatus): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new NotFoundError('Task', taskId);

    this.logger.debug('Approval confirmation attempt', { taskId, currentStatus: task.status, nextStatus });

    const category = this.processEngine.getStatusCategory(task.orgId, task.status);
    if (category !== 'approval') {
      throw new TaskStateError(task.status, nextStatus);
    }

    this.taskRepo.updateStatus(taskId, nextStatus);
    this.emitEvent('task:approval-confirmed', { taskId, orgId: task.orgId, from: task.status, to: nextStatus });

    const nextCategory = this.processEngine.getStatusCategory(task.orgId, nextStatus);
    this.logger.debug('Approval confirmed', { taskId, from: task.status, to: nextStatus, nextCategory });

    if (nextCategory === 'terminal') {
      this.emitEvent('task:completed', { taskId, orgId: task.orgId, status: nextStatus });
    }

    return this.taskRepo.findById(taskId)!;
  }

  rejectApproval(taskId: string, revertStatus: TaskStatus): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new NotFoundError('Task', taskId);

    this.logger.debug('Approval rejection attempt', { taskId, currentStatus: task.status, revertStatus });

    const category = this.processEngine.getStatusCategory(task.orgId, task.status);
    if (category !== 'approval') {
      throw new TaskStateError(task.status, revertStatus);
    }

    this.taskRepo.updateStatus(taskId, revertStatus);
    this.logger.debug('Approval rejected', { taskId, from: task.status, to: revertStatus });
    this.emitEvent('task:approval-rejected', { taskId, orgId: task.orgId, from: task.status, to: revertStatus });

    return this.taskRepo.findById(taskId)!;
  }

  private emitEvent(type: DomainEventType, payload: Record<string, unknown>): void {
    this.eventBus.emit({ type, timestamp: new Date().toISOString(), payload });
  }
}
