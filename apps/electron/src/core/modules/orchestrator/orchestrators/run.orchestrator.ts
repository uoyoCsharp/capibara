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
    this.eventBus.on('run:suspended', (e) => this.onRunEnded(e.payload.orgId));
    this.logger.info('RunOrchestrator started');
  }

  private onRunFailed(event: DomainEvent<'run:failed'>): void {
    this.retryScheduler.scheduleRetry(event.payload.runId);
  }

  private onRunEnded(orgId: string): void {
    const dispatched = this.drainPendingWakes(orgId);
    if (!dispatched) {
      this.taskOrchestrator.scheduleNext(orgId);
    }
  }

  /**
   * Drain one queued wake for this org.
   *
   * PendingWakes are the scheduling-layer queue: they hold deferred wake
   * requests that were blocked by WakeGateValidator (typically because the
   * org already had an active run). This is orthogonal to the ACP session
   * suspension mechanism — suspensions preserve agent session state while
   * pending_wakes handle role-level scheduling order.
   *
   * Only one wake is consumed per call. The resulting run will eventually
   * end, re-triggering onRunEnded → drainPendingWakes, forming a chain.
   *
   * @returns true if a wake was dispatched, false otherwise.
   *          When true, the caller should skip scheduleNext to avoid
   *          double-dispatching the same task.
   */
  private drainPendingWakes(orgId: string): boolean {
    const next = this.pendingWakeRepo.findNext(orgId);
    if (!next) return false;

    this.pendingWakeRepo.delete(next.id);

    const gate = this.wakeGateValidator.validate(next.roleId, orgId);
    if (!gate.allowed) {
      this.pendingWakeRepo.create({
        roleId: next.roleId,
        orgId,
        reason: next.reason,
        taskId: next.taskId,
        conversationId: next.conversationId,
        priority: next.priority,
      });
      return false;
    }

    this.logger.info('Draining pending wake', {
      roleId: next.roleId,
      taskId: next.taskId,
      conversationId: next.conversationId,
    });

    // Dispatch by target: conversation wakes go through executeForConversation,
    // task wakes through executeForTask. If somehow both are null the wake is
    // invalid — log and drop rather than crash the orchestrator loop.
    if (next.conversationId !== null) {
      this.runCoordinator
        .executeForConversation(next.conversationId, next.roleId, orgId, this.locale)
        .catch((err) => {
          this.logger.error('Pending wake execution failed', { error: String(err) });
        });
      return true;
    }

    if (next.taskId !== null) {
      this.runCoordinator
        .executeForTask(
          next.taskId,
          next.roleId,
          orgId,
          next.reason as WakeReason,
          this.locale,
        )
        .catch((err) => {
          this.logger.error('Pending wake execution failed', { error: String(err) });
        });
      return true;
    }

    this.logger.error('Pending wake has neither taskId nor conversationId; dropping', { id: next.id });
    return false;
  }
}
