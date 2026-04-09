import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { TaskStatus } from '@main/core/types/domain.types.js';
import { TASK_REPO_TOKEN, EVENT_BUS_TOKEN, LOGGER_TOKEN } from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';
import { InvalidTransitionError } from '@main/core/errors/workflow.errors.js';

/**
 * Validates and executes task state transitions.
 * Delegates transition validation to WorkflowEngine (schema-driven).
 */
@injectable()
export class TaskStateMachine {
  private workflowEngine: IWorkflowEngine | null = null;

  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  async canTransition(orgId: string, from: TaskStatus, to: TaskStatus): Promise<boolean> {
    if (!this.workflowEngine) {
      this.logger.warn('WorkflowEngine not set, rejecting transition');
      return false;
    }
    return this.workflowEngine.canTransition(orgId, from, to);
  }

  async transition(taskId: string, to: TaskStatus): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError('TaskNode', taskId);
    }

    if (!this.workflowEngine) {
      throw new InvalidTransitionError(task.status, to);
    }

    const allowed = await this.workflowEngine.canTransition(task.orgId, task.status, to);
    if (!allowed) {
      throw new InvalidTransitionError(task.status, to);
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
