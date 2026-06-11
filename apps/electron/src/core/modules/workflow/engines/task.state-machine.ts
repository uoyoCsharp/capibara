import { injectable } from 'tsyringe';
import type { ITaskStateMachine } from '../interfaces/i-task.state-machine';
import type { ITaskRepository } from '../interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
import { TaskStateError, NotFoundError } from '@core/foundation/errors/capibara.errors';
import type { IProcessEngine } from '../interfaces/i-process.engine';
import type { IBehaviorEngine } from '../interfaces/i-behavior.engine';
import type { Task, TaskStatus } from '../types/workflow.types';

@injectable()
export class TaskStateMachine implements ITaskStateMachine {
  private behaviorEngine: IBehaviorEngine | null = null;

  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly processEngine: IProcessEngine,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  setBehaviorEngine(engine: IBehaviorEngine): void {
    this.behaviorEngine = engine;
  }

  /**
   * @param opts.triggeredBy
   *   - 'user' (default): user/AI-initiated. Validated against schema
   *     transitions in 'manual' mode.
   *   - 'system': orchestration-driven (RunEngine task lifecycle, bootstrap
   *     reconcile). Validated against schema transitions in 'system' mode —
   *     so the schema still gatekeeps which edges are walkable, just from a
   *     different vocabulary.
   *
   * The flag is forwarded to `task:status-changed` so that orchestrators can
   * distinguish "system finished setting up the run" from a real user/AI
   * transition (and avoid double-waking).
   */
  transition(
    taskId: string,
    newStatus: TaskStatus,
    opts: { triggeredBy?: 'user' | 'system' } = {},
  ): Task {
    const triggeredBy = opts.triggeredBy ?? 'user';
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new NotFoundError('Task', taskId);

    const currentStatus = task.status;
    if (currentStatus === newStatus) return task;

    this.logger.debug('Task transition attempt', { taskId, from: currentStatus, to: newStatus, orgId: task.orgId, triggeredBy });

    if (!this.processEngine.validateTransition(task.orgId, currentStatus, newStatus)) {
      this.logger.debug('Task transition rejected', { taskId, from: currentStatus, to: newStatus });
      throw new TaskStateError(currentStatus, newStatus);
    }

    const category = this.processEngine.getStatusCategory(task.orgId, newStatus);

    if (category === 'approval' && this.taskRepo.hasChildren(taskId)) {
      this.logger.debug('Non-leaf task cannot enter approval state', { taskId, from: currentStatus, to: newStatus });
      throw new TaskStateError(
        currentStatus,
        newStatus,
        'non-leaf tasks cannot enter approval states',
      );
    }

    this.taskRepo.updateStatus(taskId, newStatus);
    this.logger.debug('Task transition completed', { taskId, from: currentStatus, to: newStatus, category, triggeredBy });

    if (category === 'approval') {
      const autoTarget = this.resolveAutoApprovalTarget(task, newStatus);
      if (autoTarget) {
        this.emitEvent('task:auto-approved', {
          taskId,
          orgId: task.orgId,
          roleId: task.assigneeRoleId,
          from: currentStatus,
          via: newStatus,
          to: autoTarget,
        });
        return this.transition(taskId, autoTarget, opts);
      }
      this.taskRepo.updatePausedReason(taskId, 'approval');
      this.emitEvent('task:entered-approval', { taskId, orgId: task.orgId, from: currentStatus, to: newStatus });
    } else {
      if (task.pausedReason) this.taskRepo.updatePausedReason(taskId, null);
      this.emitEvent('task:status-changed', {
        taskId,
        orgId: task.orgId,
        from: currentStatus,
        to: newStatus,
        assigneeRoleId: task.assigneeRoleId,
        triggeredBy,
      });
    }

    if (category === 'terminal') {
      this.emitEvent('task:completed', { taskId, orgId: task.orgId, status: newStatus });
    }

    if (this.behaviorEngine) {
      const freshTask = this.taskRepo.findById(taskId)!;
      this.behaviorEngine.onStatusEnter(freshTask);
    }

    return this.taskRepo.findById(taskId)!;
  }

  private resolveAutoApprovalTarget(task: Task, approvalStatus: TaskStatus): TaskStatus | null {
    if (!task.assigneeRoleId) return null;
    const role = this.roleRepo.findById(task.assigneeRoleId);
    if (!role || role.requiresHumanApproval) return null;

    const transitions = this.processEngine.getAvailableTransitions(task.orgId, approvalStatus);
    const target = transitions.find(
      (t) => this.processEngine.getStatusCategory(task.orgId, t.to) !== 'approval',
    );
    if (!target) {
      this.logger.warn('AI role at approval state has no non-approval transition; pausing', {
        taskId: task.id,
        roleId: role.id,
        approvalStatus,
      });
      return null;
    }
    return target.to;
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
    this.taskRepo.updatePausedReason(taskId, null);
    this.emitEvent('task:approval-confirmed', { taskId, orgId: task.orgId, from: task.status, to: nextStatus });

    const nextCategory = this.processEngine.getStatusCategory(task.orgId, nextStatus);
    this.logger.debug('Approval confirmed', { taskId, from: task.status, to: nextStatus, nextCategory });

    if (nextCategory === 'terminal') {
      this.emitEvent('task:completed', { taskId, orgId: task.orgId, status: nextStatus });
    }

    if (this.behaviorEngine) {
      const freshTask = this.taskRepo.findById(taskId)!;
      this.behaviorEngine.onStatusEnter(freshTask);
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
    this.taskRepo.updatePausedReason(taskId, null);
    this.logger.debug('Approval rejected', { taskId, from: task.status, to: revertStatus });
    this.emitEvent('task:approval-rejected', { taskId, orgId: task.orgId, from: task.status, to: revertStatus });

    return this.taskRepo.findById(taskId)!;
  }

  reconcileOrphanedActiveTasks(orgIds: string[]): void {
    let total = 0;
    for (const orgId of orgIds) {
      const initial = this.processEngine.getInitialStatus(orgId);
      if (!initial) continue;

      for (const task of this.taskRepo.findByOrgId(orgId)) {
        if (this.processEngine.getStatusCategory(orgId, task.status) !== 'active') continue;
        try {
          this.transition(task.id, initial.name, { triggeredBy: 'system' });
          total += 1;
        } catch (err) {
          this.logger.error('Failed to reconcile orphaned active task on startup', {
            taskId: task.id, from: task.status, to: initial.name, error: String(err),
          });
        }
      }
    }
    if (total > 0) {
      this.logger.info('Reconciled orphaned active tasks on startup', { count: total });
    }
  }

  private emitEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventPublisher.publish(type, payload);
  }
}
