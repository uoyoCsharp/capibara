import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent, DomainEventType } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IPendingWakeRepository } from './interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from './wake-gate.validator';
import type { RetryScheduler } from './retry.scheduler';
import type { RunCoordinator } from './run.coordinator';

@injectable()
export class Orchestrator {
  private pausedTasks = new Set<string>();
  private locale = 'en-US';

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly taskRepo: ITaskRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly convRepo: IConversationRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly wakeGateValidator: WakeGateValidator,
    private readonly retryScheduler: RetryScheduler,
    private readonly runCoordinator: RunCoordinator,
  ) {}

  start(): void {
    this.subscribe('task:status-changed', (e) => this.onTaskStatusChanged(e));
    this.subscribe('task:entered-approval', (e) => this.onTaskEnteredApproval(e));
    this.subscribe('task:approval-confirmed', (e) => this.onTaskApprovalConfirmed(e));
    this.subscribe('task:completed', (e) => this.onTaskCompleted(e));
    this.subscribe('conversation:response-needed', (e) => this.onConversationResponseNeeded(e));
    this.subscribe('conversation:resolved', (e) => this.onConversationResolved(e));
    this.subscribe('run:failed', (e) => this.onRunFailed(e));
    this.logger.info('Orchestrator started');
  }

  private subscribe<T>(type: DomainEventType, handler: (event: DomainEvent<T>) => void): void {
    this.eventBus.on(type, handler);
  }

  private onTaskStatusChanged(event: DomainEvent<unknown>): void {
    const { taskId, assigneeRoleId, orgId, from, to } = event.payload as Record<string, string>;
    this.logger.info('Task status changed', { taskId, from, to, assigneeRoleId });
    if (!assigneeRoleId || this.pausedTasks.has(taskId)) return;

    this.tryWake(assigneeRoleId, orgId, 'task_assigned', taskId);
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

    const task = this.taskRepo.findById(taskId);
    if (task?.assigneeRoleId) {
      this.tryWake(task.assigneeRoleId, orgId, 'review_approve', taskId);
    }
  }

  private onTaskCompleted(event: DomainEvent<unknown>): void {
    const { taskId, orgId } = event.payload as Record<string, string>;
    this.pausedTasks.delete(taskId);

    const task = this.taskRepo.findById(taskId);
    if (!task?.parentId) return;

    const parent = this.taskRepo.findById(task.parentId);
    if (parent?.assigneeRoleId) {
      this.tryWake(parent.assigneeRoleId, orgId, 'task_completed', parent.id);
    }
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

  private tryWake(roleId: string, orgId: string, reason: string, taskId: string | null): void {
    const gate = this.wakeGateValidator.validate(roleId, orgId);
    if (!gate.allowed) {
      this.pendingWakeRepo.create({ roleId, orgId, reason, taskId, priority: 0 });
      this.logger.info('Wake queued (gate blocked)', { roleId, reason: gate.reason });
      return;
    }

    this.logger.info('Waking agent for task', { taskId, roleId, reason });
    this.runCoordinator.executeForTask(taskId!, roleId, orgId, reason as import('@core/modules/execution/types/execution.types').WakeReason, this.locale).then((result) => {
      this.logger.info('Run completed', { taskId, roleId, runId: result.runId, status: result.status });
    }).catch((err) => {
      this.logger.error('RunCoordinator failed for task', { taskId, roleId, error: String(err) });
    });
  }
}
