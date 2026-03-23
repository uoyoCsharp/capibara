/**
 * Human Intervention Handler - Waits for user decisions in semi-auto/manual mode
 * @module application/human-interaction/human-interaction-handler
 */

import { inject, injectable } from 'tsyringe';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  PROGRESS_QUERY_SERVICE_TOKEN,
} from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { IHumanInteractionStrategy, InterventionContext } from './strategies/human-interaction.strategy.js';
import type { IProgressQueryService } from '../progress/progress-query.service.js';

@injectable()
export class HumanInteractionHandler {
  private strategy: IHumanInteractionStrategy | null = null;

  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
    @inject(PROGRESS_QUERY_SERVICE_TOKEN) private progressQuery: IProgressQueryService,
  ) {}

  /** Set interaction strategy (Terminal / GitHub Comment, etc.) */
  setStrategy(strategy: IHumanInteractionStrategy): void {
    this.strategy = strategy;
  }

  /** W3 fix: Initialize with default strategy (called by bootstrap) */
  initializeWithDefaultStrategy(strategy: IHumanInteractionStrategy): void {
    if (!this.strategy) {
      this.strategy = strategy;
    }
  }

  /** Request human review and wait for response */
  async requestApproval(
    context: PipelineContext,
    reason: string,
    currentOutput?: string,
    evaluatorResults?: string[],
  ): Promise<HumanResponse> {
    if (!this.strategy) {
      this.logger.warn('No human interaction strategy set, auto-approving');
      return { approved: true, feedback: '' };
    }

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      phase: context.currentPhase,
      eventType: 'human:intervention_requested',
      data: { reason, round: context.currentRound },
    });

    // Build intervention context with interaction history
    const interventionContext: InterventionContext = {
      pipelineId: context.pipelineId,
      changeId: context.changeId,
      phase: context.currentPhase,
      round: context.currentRound,
      mode: context.mode,
      recentInteractions: context.interactionHistory.slice(0, 3),
      currentOutput: currentOutput ?? '',
      evaluatorResults,
      escalateReason: context.mode === 'semi-auto' ? reason : undefined,
    };

    const response = await this.strategy.requestApproval(interventionContext);

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      phase: context.currentPhase,
      eventType: 'human:response_received',
      data: { approved: response.approved, feedbackLength: response.feedback.length },
    });

    return response;
  }
}

export interface HumanResponse {
  approved: boolean;
  feedback: string;
}
