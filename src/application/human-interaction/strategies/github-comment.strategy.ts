/**
 * GitHub Comment Interaction Strategy (Skeleton)
 * Interacts with users via GitHub Issue/PR Comments, Phase C implementation
 * @module application/human-interaction/strategies/github-comment
 */

import type { IHumanInteractionStrategy, InterventionContext } from './human-interaction.strategy.js';
import type { HumanResponse } from '../human-interaction.handler.js';

export class GitHubCommentStrategy implements IHumanInteractionStrategy {
  async requestApproval(context: InterventionContext): Promise<HumanResponse> {
    // TODO: Phase C - Send GitHub Comment, poll and wait for reply
    console.warn('GitHubCommentStrategy not implemented, auto-approving');
    console.log(`Would post intervention request to GitHub for pipeline ${context.pipelineId}`);
    return { approved: true, feedback: '' };
  }
}
