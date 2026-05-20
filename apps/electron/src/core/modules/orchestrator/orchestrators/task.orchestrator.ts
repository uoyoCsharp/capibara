import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IPendingWakeRepository } from '../interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '../wake-gate.validator';
import type { RunCoordinator } from '../run.coordinator';
import type { TaskScheduler } from '../task.scheduler';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import type { WakeReason } from '@core/modules/execution/types/execution.types';

/**
 * Task lifecycle coordinator. Subscribes to all task:* events and drives:
 *   - root task auto-start
 *   - wake gating on status changes
 *   - approval pause/resume (backed by tasks.paused_reason)
 *   - descent into next schedulable task after completion
 *
 * Paused state is persisted to tasks.paused_reason (no in-memory Set).
 *
 * Scheduling does NOT mutate task status here — that is the RunEngine's job.
 * scheduleNext picks the next schedulable task and asks the wake-gate to
 * dispatch a run; RunEngine then drives the initial→active transition with
 * triggeredBy:'system' so this orchestrator can ignore that echo.
 */
@injectable()
export class TaskOrchestrator {
  private locale = 'en-US';

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly taskRepo: ITaskRepository,
    private readonly orgRepo: IOrganizationRepository,
    private readonly runRepo: IRunRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly wakeGateValidator: WakeGateValidator,
    private readonly runCoordinator: RunCoordinator,
    private readonly taskScheduler: TaskScheduler,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly processEngine: ProcessEngine,
    private readonly behaviorEngine: BehaviorEngine,
  ) {}

  start(): void {
    this.eventBus.on('task:created', (e) => this.onTaskCreated(e));
    this.eventBus.on('task:status-changed', (e) => this.onTaskStatusChanged(e));
    this.eventBus.on('task:entered-approval', (e) => this.onTaskEnteredApproval(e));
    this.eventBus.on('task:approval-confirmed', (e) => this.onTaskApprovalConfirmed(e));
    this.eventBus.on('task:completed', (e) => this.onTaskCompleted(e));
    this.eventBus.on('plan-tree:approved', (e) => this.onPlanTreeApproved(e));
    this.logger.info('TaskOrchestrator started');
  }

  scheduleNext(orgId: string): void {
    const result = this.taskScheduler.findNextTask(orgId);
    if (!result) {
      this.logger.debug('No schedulable tasks', { orgId });
      return;
    }

    const { task, wakeReason } = result;
    if (!task.assigneeRoleId) {
      this.logger.warn('Schedulable task has no assignee, skipping wake', { taskId: task.id });
      return;
    }

    // Wake gate decides whether to dispatch now or queue. RunEngine — once
    // the gate clears — is the sole authority that flips the task into its
    // active status (triggeredBy:'system'), so we don't transition here.
    this.tryWake(task.assigneeRoleId, orgId, wakeReason, task.id);
  }

  /**
   * User-initiated recovery after app restart. Picks exactly one task via
   * TaskScheduler priority (depth-first, oldest-root first) and wakes it.
   * Subsequent tasks are handled by the normal run:succeeded → scheduleNext
   * chain — no bulk enqueue.
   */
  resumeInterruptedForOrg(orgId: string): number {
    const result = this.taskScheduler.findNextTask(orgId);
    if (!result || !result.task.assigneeRoleId) return 0;
    this.tryWake(result.task.assigneeRoleId, orgId, 'task_assigned', result.task.id);
    return 1;
  }

  tryWake(roleId: string, orgId: string, reason: string, taskId: string | null): void {
    const gate = this.wakeGateValidator.validate(roleId, orgId);
    if (!gate.allowed) {
      this.pendingWakeRepo.create({ roleId, orgId, reason, taskId, conversationId: null, priority: 0 });
      this.logger.info('Wake queued (gate blocked)', { roleId, reason: gate.reason });
      return;
    }

    this.logger.info('Waking agent for task', { taskId, roleId, reason });
    this.runCoordinator
      .executeForTask(taskId!, roleId, orgId, reason as WakeReason, this.locale)
      .then((result) => {
        this.logger.info('Run completed', { taskId, roleId, runId: result.runId, status: result.status });
      })
      .catch((err) => {
        this.logger.error('RunCoordinator failed for task', { taskId, roleId, error: String(err) });
      });
  }

  private onTaskCreated(event: DomainEvent<'task:created'>): void {
    const { orgId, parentId } = event.payload;
    if (parentId) return;

    const org = this.orgRepo.findById(orgId);
    if (!org?.autoStartOnCreate) return;

    this.logger.info('Auto-starting root task', { orgId });
    this.scheduleNext(orgId);
  }

  private onTaskStatusChanged(event: DomainEvent<'task:status-changed'>): void {
    const { taskId, assigneeRoleId, orgId, from, to, triggeredBy } = event.payload;
    this.logger.info('Task status changed', { taskId, from, to, assigneeRoleId, triggeredBy });

    // System-driven transitions (RunEngine starting/rolling-back a run,
    // bootstrap reconcile) are bookkeeping echoes — never re-wake from them.
    if (triggeredBy === 'system') {
      this.logger.debug('Skipping wake for system-driven transition', { taskId, from, to });
      return;
    }

    if (!assigneeRoleId) return;

    const category = this.processEngine.getStatusCategory(orgId, to);
    if (category !== 'active') {
      this.logger.debug('Skipping wake for non-active status transition', {
        taskId,
        to,
        category,
      });
      return;
    }

    const task = this.taskRepo.findById(taskId);
    if (task?.pausedReason) {
      this.logger.debug('Task is paused, skipping wake', { taskId, pausedReason: task.pausedReason });
      return;
    }

    this.tryWake(assigneeRoleId, orgId, 'task_assigned', taskId);
  }

  private onTaskEnteredApproval(event: DomainEvent<'task:entered-approval'>): void {
    // State machine already wrote paused_reason='approval' inside its transaction.
    // Nothing to do here except log — no wake should happen, which is enforced
    // by onTaskStatusChanged skipping paused tasks.
    this.logger.info('Task entered approval', { taskId: event.payload.taskId });
  }

  private onTaskApprovalConfirmed(event: DomainEvent<'task:approval-confirmed'>): void {
    const { taskId, orgId } = event.payload;
    this.logger.info('Task approval confirmed, resuming scheduling', { taskId });
    this.scheduleNext(orgId);
  }

  private onTaskCompleted(event: DomainEvent<'task:completed'>): void {
    const { taskId, orgId } = event.payload;

    const task = this.taskRepo.findById(taskId);
    if (!task) return;

    this.behaviorEngine.onChildCompleted(task);
    this.scheduleNext(orgId);
  }

  // Preview-tree approve path: children have just been materialized under a
  // root that is typically already in_progress. advanceRootAfterDecomposition
  // in PlanningService no-ops in that case, so no task:status-changed is
  // emitted to drive scheduling. We must kick the scheduler explicitly.
  private onPlanTreeApproved(event: DomainEvent<'plan-tree:approved'>): void {
    const { rootTaskId, orgId } = event.payload;
    this.logger.info('Plan tree approved, resuming scheduling', { rootTaskId, orgId });
    this.scheduleNext(orgId);
  }
}
