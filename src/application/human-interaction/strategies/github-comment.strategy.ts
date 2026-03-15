/**
 * GitHub Comment Interaction Strategy (Skeleton)
 * Interacts with users via GitHub Issue/PR Comments, Phase C implementation
 * @module application/human-interaction/strategies/github-comment
 */

import type { IHumanInteractionStrategy } from './human-interaction.strategy.js';
import type { PipelineContext } from '../../../core/types/pipeline.types.js';
import type { HumanResponse } from '../human-interaction.handler.js';

export class GitHubCommentStrategy implements IHumanInteractionStrategy {
  async requestApproval(context: PipelineContext, reason: string): Promise<HumanResponse> {
    // TODO: Phase C - Send GitHub Comment, poll and wait for reply
    console.warn('GitHubCommentStrategy not implemented, auto-approving');
    return { approved: true, feedback: '' };
  }
}
