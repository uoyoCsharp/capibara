import { injectable, inject } from 'tsyringe';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import {
  COST_ENTRY_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';

/**
 * Listens for run:succeeded events and records cost entries.
 */
@injectable()
export class CostTracker {
  constructor(
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  start(): void {
    this.eventBus.on('run:succeeded', (event: DomainEvent) => {
      void this.recordCost(event);
    });
    this.logger.info('CostTracker started');
  }

  private async recordCost(event: DomainEvent): Promise<void> {
    const payload = event.payload as {
      runId: string;
      roleId: string;
      orgId: string;
      tokenCount: number;
    };

    if (!payload.runId || !payload.orgId) return;

    await this.costRepo.create({
      runId: payload.runId,
      roleId: payload.roleId,
      orgId: payload.orgId,
      tokenCount: payload.tokenCount ?? 0,
    });

    this.logger.debug('Cost entry recorded', {
      runId: payload.runId,
      tokenCount: payload.tokenCount,
    });
  }
}
