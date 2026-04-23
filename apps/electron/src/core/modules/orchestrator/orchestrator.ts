import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent, DomainEventType } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IPendingWakeRepository } from './interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from './wake-gate.validator';
import type { RetryScheduler } from './retry.scheduler';
import type { RunCoordinator } from './run.coordinator';
import type { TaskScheduler } from './task.scheduler';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import type { WakeReason } from '@core/modules/execution/types/execution.types';

@injectable()
export class Orchestrator {
  private pausedTasks = new Set<string>();
  private scheduledTaskIds = new Set<string>();
  private locale = 'en-US';

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly taskRepo: ITaskRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly orgRepo: IOrganizationRepository,
    private readonly convRepo: IConversationRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly wakeGateValidator: WakeGateValidator,
    private readonly retryScheduler: RetryScheduler,
    private readonly runCoordinator: RunCoordinator,
    private readonly taskScheduler: TaskScheduler,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly processEngine: ProcessEngine,
    private readonly behaviorEngine: BehaviorEngine,
  ) {}

  start(): void {
    this.subscribe('task:created', (e) => this.onTaskCreated(e));
    this.subscribe('task:status-changed', (e) => this.onTaskStatusChanged(e));
    this.subscribe('task:entered-approval', (e) => this.onTaskEnteredApproval(e));
    this.subscribe('task:approval-confirmed', (e) => this.onTaskApprovalConfirmed(e));
    this.subscribe('task:completed', (e) => this.onTaskCompleted(e));
    this.subscribe('conversation:response-needed', (e) => this.onConversationResponseNeeded(e));
    this.subscribe('conversation:resolved', (e) => this.onConversationResolved(e));
    this.subscribe('run:failed', (e) => {
      this.onRunFailed(e);
      this.onRunEnded(e);
    });
    this.subscribe('run:succeeded', (e) => this.onRunEnded(e));
    this.subscribe('run:cancelled', (e) => this.onRunEnded(e));
    this.logger.info('Orchestrator started');
  }

  private subscribe<T>(type: DomainEventType, handler: (event: DomainEvent<T>) => void): void {
    this.eventBus.on(type, handler);
  }

  private onTaskCreated(event: DomainEvent<unknown>): void {
    const { orgId, parentId } = event.payload as Record<string, string | null>;
    if (parentId) return;

    const org = this.orgRepo.findById(orgId as string);
    if (!org?.autoStartOnCreate) return;

    this.logger.info('Auto-starting root task', { orgId });
    this.scheduleNext(orgId as string);
  }

  private onTaskStatusChanged(event: DomainEvent<unknown>): void {
    const { taskId, assigneeRoleId, orgId, from, to } = event.payload as Record<string, string>;
    this.logger.info('Task status changed', { taskId, from, to, assigneeRoleId });
    if (!assigneeRoleId || this.pausedTasks.has(taskId)) return;

    const reason: WakeReason = this.scheduledTaskIds.has(taskId)
      ? 'task_scheduled'
      : 'task_assigned';
    this.scheduledTaskIds.delete(taskId);

    this.tryWake(assigneeRoleId, orgId, reason, taskId);
  }

  private onTaskEnteredApproval(event: DomainEvent<unknown>): void {
    const { taskId } = event.payload as Record<string, string>;
    this.pausedTasks.add(taskId);
    this.logger.info('Task scheduling paused for approval', { taskId });
  }

  private onTaskApprovalConfirmed(event: DomainEvent<unknown>): void {
    const { taskId, orgId } = event.payload as Record<string, string>;
    this.pausedTasks.delete(taskId);
    this.logger.info('Task scheduling resumed after approval', { taskId });

    this.scheduleNext(orgId);
  }

  private onTaskCompleted(event: DomainEvent<unknown>): void {
    const { taskId, orgId } = event.payload as Record<string, string>;
    this.pausedTasks.delete(taskId);

    const task = this.taskRepo.findById(taskId);
    if (!task) return;

    this.behaviorEngine.onChildCompleted(task);

    this.scheduleNext(orgId);
  }

  private onConversationResponseNeeded(event: DomainEvent<unknown>): void {
    const { conversationId, orgId, roleId } = event.payload as Record<string, string>;
    if (!roleId) return;

    const gate = this.wakeGateValidator.validate(roleId, orgId);
    if (!gate.allowed) {
      this.logger.info('Conversation wake blocked', { conversationId, roleId, reason: gate.reason });
      return;
    }

    this.runCoordinator.executeForConversation(conversationId, roleId, orgId, this.locale).catch((err) => {
      this.logger.error('RunCoordinator failed for conversation', { conversationId, error: String(err) });
    });
  }

  private onConversationResolved(event: DomainEvent<unknown>): void {
    const { conversationId } = event.payload as Record<string, string>;
    const conv = this.convRepo.findById(conversationId);
    if (!conv?.taskId || !conv.initiatorRoleId) return;

    this.tryWake(conv.initiatorRoleId, conv.orgId, 'conversation_reply', conv.taskId);
  }

  private onRunFailed(event: DomainEvent<unknown>): void {
    const { runId } = event.payload as Record<string, string>;
    this.retryScheduler.scheduleRetry(runId);
  }

  private onRunEnded(event: DomainEvent<unknown>): void {
    const { orgId } = event.payload as Record<string, string>;

    this.drainPendingWakes(orgId);
    this.scheduleNext(orgId);
  }

  private scheduleNext(orgId: string): void {
    const result = this.taskScheduler.findNextTask(orgId);
    if (!result) {
      this.logger.debug('No schedulable tasks', { orgId });
      return;
    }

    const { task } = result;

    const transitions = this.processEngine.getAvailableTransitions(orgId, task.status);
    const activeTarget = transitions.find((t) => {
      const cat = this.processEngine.getStatusCategory(orgId, t.to);
      return cat === 'active';
    });

    if (!activeTarget) {
      this.logger.warn('No active transition from initial status', {
        taskId: task.id,
        status: task.status,
      });
      return;
    }

    this.scheduledTaskIds.add(task.id);
    this.taskStateMachine.transition(task.id, activeTarget.to);
  }

  private drainPendingWakes(orgId: string): void {
    const next = this.pendingWakeRepo.findNext(orgId);
    if (!next) return;

    this.pendingWakeRepo.delete(next.id);

    const gate = this.wakeGateValidator.validate(next.roleId, orgId);
    if (!gate.allowed) {
      this.pendingWakeRepo.create({
        roleId: next.roleId,
        orgId,
        reason: next.reason,
        taskId: next.taskId,
        priority: next.priority,
      });
      return;
    }

    this.logger.info('Draining pending wake', { roleId: next.roleId, taskId: next.taskId });
    this.runCoordinator
      .executeForTask(
        next.taskId!,
        next.roleId,
        orgId,
        next.reason as WakeReason,
        this.locale,
      )
      .catch((err) => {
        this.logger.error('Pending wake execution failed', { error: String(err) });
      });
  }

  private tryWake(roleId: string, orgId: string, reason: string, taskId: string | null): void {
    const gate = this.wakeGateValidator.validate(roleId, orgId);
    if (!gate.allowed) {
      this.pendingWakeRepo.create({ roleId, orgId, reason, taskId, priority: 0 });
      this.logger.info('Wake queued (gate blocked)', { roleId, reason: gate.reason });
      return;
    }

    this.logger.info('Waking agent for task', { taskId, roleId, reason });
    this.runCoordinator.executeForTask(taskId!, roleId, orgId, reason as WakeReason, this.locale).then((result) => {
      this.logger.info('Run completed', { taskId, roleId, runId: result.runId, status: result.status });
    }).catch((err) => {
      this.logger.error('RunCoordinator failed for task', { taskId, roleId, error: String(err) });
    });
  }
}
