/**
 * Cost Tracker - Records LLM call costs throughout Pipeline
 * @module infrastructure/observability/cost-tracker
 */

import { inject, injectable } from 'tsyringe';
import { LOGGER_TOKEN, EVENT_BUS_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';

@injectable()
export class CostTracker {
  private totalCost = 0;

  constructor(
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
  ) {}

  /** Accumulate cost from one API call */
  add(costUsd: number): void {
    this.totalCost += costUsd;
    this.logger.debug({ costUsd, totalCost: this.totalCost }, 'Cost tracked');
  }

  /** Get current accumulated total cost */
  getTotalCost(): number {
    return this.totalCost;
  }

  /** Reset cost counter (for new Pipeline) */
  reset(): void {
    this.totalCost = 0;
  }

  /**
   * Check if budget threshold is exceeded
   * @returns true if over limit
   */
  isOverBudget(limit: number): boolean {
    return this.totalCost >= limit;
  }
}
