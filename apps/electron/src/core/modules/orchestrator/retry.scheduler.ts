import { injectable } from 'tsyringe';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IPendingWakeRepository } from './interfaces/i-pending-wake.repository';
import type { CapibaraConfig } from '@core/config/config.types';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

@injectable()
export class RetryScheduler {
  private retryCounts = new Map<string, number>();

  constructor(
    private readonly runRepo: IRunRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly config: CapibaraConfig,
    private readonly logger: ILogger,
  ) {}

  scheduleRetry(runId: string): boolean {
    const run = this.runRepo.findById(runId);
    if (!run) return false;

    const key = run.taskId ?? run.conversationId ?? runId;
    const count = (this.retryCounts.get(key) ?? 0) + 1;

    if (count > this.config.execution.maxRetryOnFailure) {
      this.logger.warn('Max retries reached', { runId, retryCount: count });
      this.retryCounts.delete(key);
      return false;
    }

    this.retryCounts.set(key, count);
    const backoffMs = this.config.execution.retryBackoffMs * Math.pow(2, count - 1);

    this.logger.info('Scheduling retry', { runId, attempt: count, backoffMs });

    setTimeout(() => {
      this.pendingWakeRepo.create({
        roleId: run.roleId,
        orgId: run.orgId,
        reason: 'retry_failed',
        taskId: run.taskId,
        priority: -1,
      });
    }, backoffMs);

    return true;
  }

  clearRetries(key: string): void {
    this.retryCounts.delete(key);
  }
}
