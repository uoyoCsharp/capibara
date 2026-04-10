import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { WakeTrigger, Role } from '@main/core/types/domain.types.js';

export type GateResult =
  | { allowed: true; role: Role }
  | { allowed: false; reason: string };

/**
 * Validates wake-up preconditions: role activity, budget, serial execution,
 * and circuit breaker. Extracted from OrgOrchestrator (P2-2).
 */
export class WakeGateValidator {
  constructor(
    private readonly config: CapibaraConfig,
    private readonly logger: ILogger,
    private readonly eventBus: IEventBus,
    private readonly roleRepo: IRoleRepository,
    private readonly runRepo: IRunRepository,
    private readonly costRepo: ICostEntryRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
  ) {}

  async check(
    roleId: string,
    orgId: string,
    taskNodeId: string,
    trigger: WakeTrigger,
  ): Promise<GateResult> {
    // Gate 1: Role status check
    const role = await this.roleRepo.findById(roleId);
    if (!role || role.status !== 'active') {
      this.logger.debug('Wake skipped: role inactive or not found', { roleId });
      return { allowed: false, reason: 'role_inactive' };
    }

    // Gate 2: Budget check (token-based, units: millions of tokens)
    const budgetLimit = this.config.execution.budgetLimit;
    if (budgetLimit > 0) {
      const totalTokens = await this.costRepo.getTotalTokensByOrgId(orgId);
      const totalTokensM = totalTokens / 1_000_000;
      if (totalTokensM >= budgetLimit) {
        this.logger.warn('Wake skipped: budget exceeded', { orgId, totalTokensM });
        this.eventBus.emit({
          type: 'budget:exceeded',
          timestamp: new Date().toISOString(),
          payload: { orgId, totalTokens, limit: budgetLimit },
        });
        return { allowed: false, reason: 'budget_exceeded' };
      }
    }

    // Gate 3: Per-org serial execution — only one run at a time per organization
    const activeRun = await this.runRepo.findActiveByOrgId(orgId);
    if (activeRun) {
      this.logger.debug('Wake deferred: org has active run, enqueuing pending wake', {
        roleId, orgId, trigger, activeRunId: activeRun.id,
      });
      const priority = this.triggerToPriority(trigger);
      await this.pendingWakeRepo.create({ roleId, orgId, trigger, taskNodeId, priority });
      this.eventBus.emit({
        type: 'wake:pending-enqueued',
        timestamp: new Date().toISOString(),
        payload: { roleId, trigger, priority },
      });
      return { allowed: false, reason: 'org_busy' };
    }

    // Gate 4: Self-wake circuit breaker (persisted in roles table)
    const selfWakeCount = role.consecutiveWakeCount;
    if (selfWakeCount >= this.config.execution.maxConsecutiveWakes) {
      this.logger.warn('Circuit breaker: self-wake limit reached', { roleId, selfWakeCount });
      this.eventBus.emit({
        type: 'circuit-breaker:self-wake',
        timestamp: new Date().toISOString(),
        payload: { roleId, count: selfWakeCount },
      });
      this.escalateCircuitBreaker(role, orgId, taskNodeId, selfWakeCount);
      return { allowed: false, reason: 'circuit_breaker' };
    }

    return { allowed: true, role };
  }

  async incrementWakeCount(roleId: string, currentCount: number): Promise<void> {
    await this.roleRepo.update({ id: roleId, consecutiveWakeCount: currentCount + 1 });
  }

  async resetWakeCount(roleId: string): Promise<void> {
    await this.roleRepo.update({ id: roleId, consecutiveWakeCount: 0 });
  }

  triggerToPriority(trigger: WakeTrigger): number {
    switch (trigger) {
      case 'conversation_escalation': return 2;
      case 'discussion_reply': return 1;
      default: return 0;
    }
  }

  private escalateCircuitBreaker(
    role: Role,
    orgId: string,
    taskNodeId: string,
    selfWakeCount: number,
  ): void {
    if (role.parentId) {
      this.eventBus.emit({
        type: 'wake:triggered',
        timestamp: new Date().toISOString(),
        payload: { roleId: role.parentId, orgId, trigger: 'retry_failed' as WakeTrigger, taskNodeId },
      });
    } else {
      this.logger.error('Escalation reached top-level role with no parent', {
        roleId: role.id, orgId, taskNodeId,
      });
      this.eventBus.emit({
        type: 'escalation:top-level',
        timestamp: new Date().toISOString(),
        payload: {
          roleId: role.id,
          roleName: role.name,
          orgId,
          taskId: taskNodeId,
          taskTitle: taskNodeId,
          escalationChain: [role.id],
          failureReason: `Self-wake circuit breaker triggered after ${selfWakeCount} consecutive wakes`,
        },
      });
    }
  }
}
