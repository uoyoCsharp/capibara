import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IPendingWakeRepository } from '../interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '../wake-gate.validator';
import type { RetryScheduler } from '../retry.scheduler';
import type { RunCoordinator } from '../run.coordinator';
import type { TaskOrchestrator } from './task.orchestrator';
import type { WakeReason } from '@core/modules/execution/types/execution.types';

/**
 * Run lifecycle coordinator. When a Run ends (succeed / fail / cancel):
 *   - failed runs go to RetryScheduler
 *   - pending-wake queue is drained for the org
 *   - TaskOrchestrator is asked to schedule the next task
 */
@injectable()
export class RunOrchestrator {
  private locale = 'en-US';

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly wakeGateValidator: WakeGateValidator,
    private readonly retryScheduler: RetryScheduler,
    private readonly runCoordinator: RunCoordinator,
    private readonly taskOrchestrator: TaskOrchestrator,
  ) {}

  start(): void {
    this.eventBus.on('run:failed', (e) => {
      this.onRunFailed(e);
      this.onRunEnded(e.payload.orgId);
    });
    this.eventBus.on('run:succeeded', (e) => this.onRunEnded(e.payload.orgId));
    this.eventBus.on('run:cancelled', (e) => this.onRunEnded(e.payload.orgId));
    this.logger.info('RunOrchestrator started');
  }

  private onRunFailed(event: DomainEvent<'run:failed'>): void {
    this.retryScheduler.scheduleRetry(event.payload.runId);
  }

  private onRunEnded(orgId: string): void {
    this.drainPendingWakes(orgId);
    this.taskOrchestrator.scheduleNext(orgId);
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
}
