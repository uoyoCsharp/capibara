import { injectable, inject } from 'tsyringe';
import type { IDiscussionRepository, VoteStats } from '@main/core/interfaces/i-discussion.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import {
  DISCUSSION_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  TASK_REPO_TOKEN,
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
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  async evaluate(discussionGroupId: string): Promise<ConsensusResult> {
    const group = await this.discussionRepo.findGroupById(discussionGroupId);
    if (!group) {
      return { outcome: 'pending' };
    }

    // Bug 3 fix: only count votes from the current review round
    const stats = await this.discussionRepo.getVoteStatsForRound(discussionGroupId, group.currentRound);
    this.logger.debug('Evaluating consensus', { discussionGroupId, round: group.currentRound, stats });

    // Check for delegation first
    // Bug 4 fix: read targetRoleId from message metadata instead of authorRoleId
    if (stats.DELEGATE > 0) {
      const messages = await this.discussionRepo.findRecentMessages(discussionGroupId, 10);
      const delegateMsg = messages.find((m) => m.voteTag === 'DELEGATE' && m.reviewRound === group.currentRound);
      if (delegateMsg) {
        const rawTarget = (delegateMsg.metadata as Record<string, unknown> | null)?.targetRoleId;
        const targetRoleId = typeof rawTarget === 'string' ? rawTarget : '';
        return { outcome: 'delegated', targetRoleId };
      }
    }

    // Dispute: concerns with no approvals
    if (stats.CONCERN > 0 && stats.APPROVE === 0) {
      return { outcome: 'disputed' };
    }

    // Revision requested
    if (stats.REVISE > 0) {
      const messages = await this.discussionRepo.findRecentMessages(discussionGroupId, 10);
      const reviseMsg = messages.find((m) => m.voteTag === 'REVISE' && m.reviewRound === group.currentRound);
      return { outcome: 'revision', feedback: reviseMsg?.content ?? '' };
    }

    // Risk 11 fix: check canApprove quorum
    // Get all roles with canApprove=true in the org, excluding the task assignee
    const task = group.taskNodeId ? await this.taskRepo.findById(group.taskNodeId) : null;
    if (task) {
      const orgRoles = await this.roleRepo.findByOrgId(task.orgId);
      const eligibleVoters = orgRoles.filter(
        (r) => r.canApprove && r.id !== task.assigneeRoleId && r.status === 'active',
      );

      if (eligibleVoters.length > 0) {
        // Check that all eligible voters have voted APPROVE in this round
        const roundMessages = await this.discussionRepo.findRecentMessages(discussionGroupId, 50);
        const currentRoundVotes = roundMessages.filter((m) => m.reviewRound === group.currentRound && m.voteTag != null);
        const approvedVoterIds = new Set(
          currentRoundVotes.filter((m) => m.voteTag === 'APPROVE' && m.authorRoleId).map((m) => m.authorRoleId),
        );
        const allEligibleVoted = eligibleVoters.every((v) => approvedVoterIds.has(v.id));

        if (stats.APPROVE > 0 && stats.REVISE === 0 && stats.CONCERN === 0 && allEligibleVoted) {
          this.logger.info('Consensus reached: approved (quorum met)', { discussionGroupId });
          return { outcome: 'approved' };
        }

        // If some eligible voters haven't voted yet, stay pending
        if (stats.APPROVE > 0 && stats.REVISE === 0 && stats.CONCERN === 0 && !allEligibleVoted) {
          return { outcome: 'pending' };
        }
      }
    }

    // Fallback: no eligible voters configured or no task context — approve on any APPROVE vote
    if (stats.APPROVE > 0 && stats.REVISE === 0 && stats.CONCERN === 0) {
      this.logger.info('Consensus reached: approved', { discussionGroupId });
      return { outcome: 'approved' };
    }

    return { outcome: 'pending' };
  }
}
