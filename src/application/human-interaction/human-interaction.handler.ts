/**
 * Human Intervention Handler - Waits for user decisions in semi-auto/manual mode
 * @module application/human-interaction/human-interaction-handler
 */

import { inject, injectable } from 'tsyringe';
import { CONFIG_TOKEN, LOGGER_TOKEN, EVENT_BUS_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { IHumanInteractionStrategy } from './strategies/human-interaction.strategy.js';

@injectable()
export class HumanInteractionHandler {
  private strategy: IHumanInteractionStrategy | null = null;

  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
  ) {}

  /** Set interaction strategy (Terminal / GitHub Comment, etc.) */
  setStrategy(strategy: IHumanInteractionStrategy): void {
    this.strategy = strategy;
  }

  /** Request human review and wait for response */
  async requestApproval(context: PipelineContext, reason: string): Promise<HumanResponse> {
    if (!this.strategy) {
      this.logger.warn('No human interaction strategy set, auto-approving');
      return { approved: true, feedback: '' };
    }

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      phase: context.currentPhase,
      eventType: 'human:intervention_requested',
      data: { reason },
    });

    const response = await this.strategy.requestApproval(context, reason);

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      phase: context.currentPhase,
      eventType: 'human:response_received',
      data: { approved: response.approved },
    });

    return response;
  }
}

export interface HumanResponse {
  approved: boolean;
  feedback: string;
}
