import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { WakeTrigger } from '@main/core/types/domain.types.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';

/**
 * Manages retry scheduling with exponential backoff and escalation
 * to parent roles when retries are exhausted. Extracted from OrgOrchestrator (P2-2).
 */
export class RetryScheduler {
  private retryCounts = new Map<string, number>(); // key: taskNodeId
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly config: CapibaraConfig,
    private readonly logger: ILogger,
    private readonly eventBus: IEventBus,
    private readonly roleRepo: IRoleRepository,
  ) {}

  private taskStateMachine!: TaskStateMachine;

  setTaskStateMachine(sm: TaskStateMachine): void {
    this.taskStateMachine = sm;
  }

  /** Handle a run failure by scheduling retry or escalating. */
  async handleFailure(
    roleId: string,
    orgId: string,
    taskNodeId: string,
    wakeCallback: (roleId: string, orgId: string, taskNodeId: string, trigger: WakeTrigger) => Promise<boolean>,
  ): Promise<void> {
    const retryCount = this.retryCounts.get(taskNodeId) ?? 0;
    const maxRetries = this.config.execution.maxRetryOnFailure;

    if (retryCount < maxRetries) {
      const backoff = this.config.execution.retryBackoffMs * Math.pow(2, retryCount);
      this.retryCounts.set(taskNodeId, retryCount + 1);
      this.logger.info('Scheduling retry with backoff', {
        roleId, taskNodeId, retryCount: retryCount + 1, maxRetries, backoffMs: backoff,
      });
      this.scheduleRetry(roleId, orgId, taskNodeId, backoff, wakeCallback);
    } else {
      this.logger.warn('Retries exhausted, escalating', { roleId, taskNodeId, retryCount });
      this.retryCounts.delete(taskNodeId);
      await this.escalateToParent(roleId, orgId, taskNodeId);
    }
  }

  /** Mark a task as successfully completed — clear retry state. */
  clearRetryState(taskNodeId: string): void {
    this.retryCounts.delete(taskNodeId);
  }

  private scheduleRetry(
    roleId: string,
    orgId: string,
    taskNodeId: string,
    backoffMs: number,
    wakeCallback: (roleId: string, orgId: string, taskNodeId: string, trigger: WakeTrigger) => Promise<boolean>,
  ): void {
    const existing = this.retryTimers.get(taskNodeId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.retryTimers.delete(taskNodeId);
      void wakeCallback(roleId, orgId, taskNodeId, 'retry_failed');
    }, backoffMs);

    this.retryTimers.set(taskNodeId, timer);
  }

  private async escalateToParent(roleId: string, orgId: string, taskNodeId: string): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) return;

    // Mark the failed task as blocked
    try {
      await this.taskStateMachine.transition(taskNodeId, 'blocked');
      this.logger.info('Task marked as blocked due to escalation', { taskNodeId });
    } catch {
      // Task may already be in a state that doesn't allow blocked transition
    }

    if (role.parentId) {
      const parentRole = await this.roleRepo.findById(role.parentId);
      if (parentRole) {
        this.logger.info('Escalating to parent role', {
          fromRole: role.name, toRole: parentRole.name, taskNodeId,
        });
        this.eventBus.emit({
          type: 'wake:triggered',
          timestamp: new Date().toISOString(),
          payload: { roleId: role.parentId, orgId, trigger: 'retry_failed' as WakeTrigger },
        });
        return;
      }
    }

    // No parent — top-level escalation
    this.logger.error('Escalation reached top-level role after retries exhausted', {
      roleId, orgId, taskNodeId,
    });
    this.eventBus.emit({
      type: 'escalation:top-level',
      timestamp: new Date().toISOString(),
      payload: {
        roleId,
        roleName: role.name,
        orgId,
        taskId: taskNodeId,
        taskTitle: taskNodeId,
        escalationChain: [roleId],
        failureReason: `All ${this.config.execution.maxRetryOnFailure} retries exhausted for role "${role.name}"`,
      },
    });
  }

  stop(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCounts.clear();
  }
}
