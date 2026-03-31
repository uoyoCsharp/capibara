import { injectable, inject } from 'tsyringe';
import type { IDiscussionRepository, VoteStats } from '@main/core/interfaces/i-discussion.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import {
  DISCUSSION_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';

export type ConsensusResult =
  | { outcome: 'approved' }
  | { outcome: 'revision'; feedback: string }
  | { outcome: 'delegated'; targetRoleId: string }
  | { outcome: 'disputed' }
  | { outcome: 'pending' };

/**
 * Evaluates discussion group votes to determine consensus outcome.
 * See Architecture §9 — Discussion System.
 */
@injectable()
export class ConsensusDetector {
  constructor(
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  async evaluate(discussionGroupId: string): Promise<ConsensusResult> {
    const group = await this.discussionRepo.findGroupById(discussionGroupId);
    if (!group) {
      return { outcome: 'pending' };
    }

    const stats = await this.discussionRepo.getVoteStats(discussionGroupId);
    this.logger.debug('Evaluating consensus', { discussionGroupId, stats });

    // Check for delegation first
    if (stats.DELEGATE > 0) {
      const messages = await this.discussionRepo.findRecentMessages(discussionGroupId, 10);
      const delegateMsg = messages.find((m) => m.voteTag === 'DELEGATE');
      if (delegateMsg) {
        return { outcome: 'delegated', targetRoleId: delegateMsg.authorRoleId ?? '' };
      }
    }

    // Dispute: concerns with no approvals
    if (stats.CONCERN > 0 && stats.APPROVE === 0) {
      return { outcome: 'disputed' };
    }

    // Revision requested
    if (stats.REVISE > 0) {
      const messages = await this.discussionRepo.findRecentMessages(discussionGroupId, 10);
      const reviseMsg = messages.find((m) => m.voteTag === 'REVISE');
      return { outcome: 'revision', feedback: reviseMsg?.content ?? '' };
    }

    // Unanimous approval: all canApprove roles have voted APPROVE
    if (stats.APPROVE > 0 && stats.REVISE === 0 && stats.CONCERN === 0) {
      this.logger.info('Consensus reached: approved', { discussionGroupId });
      return { outcome: 'approved' };
    }

    return { outcome: 'pending' };
  }
}
