/**
 * Human Interaction Strategy Interface
 * @module application/human-interaction/strategies
 */

import type { PipelineContext } from '../../../core/types/pipeline.types.js';
import type { HumanResponse } from '../human-interaction.handler.js';

export interface IHumanInteractionStrategy {
  /** Request human approval, return approval result */
  requestApproval(context: PipelineContext, reason: string): Promise<HumanResponse>;
}
