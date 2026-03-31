import { injectable, inject } from 'tsyringe';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import type { WakeTrigger } from '@main/core/types/domain.types.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  RUN_REPO_TOKEN,
  PENDING_WAKE_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
} from '@main/core/tokens.js';
import { BudgetExceededError, CircuitBreakerError } from '@main/core/errors/capibara.errors.js';

/**
 * Central orchestration engine. Listens for domain events and coordinates
 * wake-up calls to roles based on event triggers.
 *
 * See Architecture §6 — Event-Driven Wake-Up Loop.
 */
@injectable()
export class OrgOrchestrator {
  private selfWakeCounts = new Map<string, number>();

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(PENDING_WAKE_REPO_TOKEN) private readonly pendingWakeRepo: IPendingWakeRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
  ) {}

  start(): void {
    this.eventBus.on('task:completed', (e) => this.handleEvent(e));
    this.eventBus.on('task:status-changed', (e) => this.handleEvent(e));
    this.eventBus.on('discussion:vote-added', (e) => this.handleEvent(e));
    this.eventBus.on('run:succeeded', (e) => this.handleEvent(e));
    this.eventBus.on('run:failed', (e) => this.handleEvent(e));
    this.eventBus.on('run:timed-out', (e) => this.handleEvent(e));
    this.logger.info('OrgOrchestrator started — listening for domain events');
  }

  async handleEvent(event: DomainEvent): Promise<void> {
    this.logger.debug('OrgOrchestrator handling event', { type: event.type });
    // Concrete routing logic will be implemented per-trigger in future stories
  }

  async wakeRoleIfPossible(roleId: string, orgId: string, trigger: WakeTrigger): Promise<boolean> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || role.status !== 'active') {
      this.logger.debug('Wake skipped: role inactive or not found', { roleId });
      return false;
    }

    // Gate: budget check
    const totalCost = await this.costRepo.getTotalCostByOrgId(orgId);
    if (totalCost >= this.config.execution.budgetLimit) {
      this.logger.warn('Wake skipped: budget exceeded', { orgId, totalCost });
      this.eventBus.emit({
        type: 'budget:exceeded',
        timestamp: new Date().toISOString(),
        payload: { orgId, totalCost, limit: this.config.execution.budgetLimit },
      });
      return false;
    }

    // Gate: no active run
    const activeRun = await this.runRepo.findActiveByRoleId(roleId);
    if (activeRun) {
      this.logger.debug('Wake deferred: role busy, enqueuing pending wake', { roleId, trigger });
      await this.pendingWakeRepo.create({ roleId, orgId, trigger });
      this.eventBus.emit({
        type: 'wake:pending-enqueued',
        timestamp: new Date().toISOString(),
        payload: { roleId, trigger },
      });
      return false;
    }

    // Gate: self-wake circuit breaker
    const selfWakeCount = this.selfWakeCounts.get(roleId) ?? 0;
    if (selfWakeCount >= this.config.execution.maxConsecutiveWakes) {
      this.logger.warn('Circuit breaker: self-wake limit reached', { roleId, selfWakeCount });
      this.eventBus.emit({
        type: 'circuit-breaker:self-wake',
        timestamp: new Date().toISOString(),
        payload: { roleId, count: selfWakeCount },
      });
      return false;
    }

    this.selfWakeCounts.set(roleId, selfWakeCount + 1);
    this.logger.info('Waking role', { roleId, trigger });

    this.eventBus.emit({
      type: 'wake:triggered',
      timestamp: new Date().toISOString(),
      payload: { roleId, orgId, trigger },
    });

    return true;
  }

  resetSelfWakeCount(roleId: string): void {
    this.selfWakeCounts.delete(roleId);
  }
}
