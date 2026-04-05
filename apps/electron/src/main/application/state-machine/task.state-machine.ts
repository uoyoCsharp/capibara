import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { TaskStatus } from '@main/core/types/domain.types.js';
import { TASK_REPO_TOKEN, EVENT_BUS_TOKEN, LOGGER_TOKEN } from '@main/core/tokens.js';
import { TASK_TRANSITIONS } from '@main/core/constants/task.constants.js';
import { TaskStateError, NotFoundError } from '@main/core/errors/capibara.errors.js';

/**
 * Validates and executes task state transitions.
 * See Architecture §6.4 — Consensus State Machine.
 */
@injectable()
export class TaskStateMachine {
  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    const allowed = TASK_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  async transition(taskId: string, to: TaskStatus): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError('TaskNode', taskId);
    }

    if (!this.canTransition(task.status, to)) {
      throw new TaskStateError(task.status, to);
    }

    await this.taskRepo.updateStatus(taskId, to);
    this.logger.info('Task state transition', { taskId, from: task.status, to });

    this.eventBus.emit({
      type: 'task:status-changed',
      timestamp: new Date().toISOString(),
      payload: { taskId, orgId: task.orgId, from: task.status, to, newStatus: to },
    });
  }
}
