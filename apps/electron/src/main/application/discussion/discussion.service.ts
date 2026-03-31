import { injectable, inject } from 'tsyringe';
import type { IDiscussionRepository, VoteStats } from '@main/core/interfaces/i-discussion.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import type { DiscussionGroup, DiscussionMessage, AuthorType, VoteTag } from '@main/core/types/domain.types.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  DISCUSSION_REPO_TOKEN,
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  CONSENSUS_DETECTOR_TOKEN,
} from '@main/core/tokens.js';
import type { ConsensusDetector } from '../consensus/consensus.detector.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';

/**
 * Manages discussion group lifecycle: auto-creation for epic tasks,
 * message posting with consensus evaluation, dispute detection,
 * and deterministic auto-summary generation.
 *
 * See Architecture §9 — Discussion System.
 */
@injectable()
export class DiscussionService {
  /** Tracks REVISE count per taskNodeId for cycle protection. */
  private reviseCounts = new Map<string, number>();

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    private readonly consensusDetector: ConsensusDetector,
    private readonly taskStateMachine: TaskStateMachine,
  ) {}

  /** Subscribe to domain events for auto-creation and consensus evaluation. */
  start(): void {
    this.eventBus.on('task:created', (e: DomainEvent) => this.onTaskCreated(e));
    this.eventBus.on('discussion:vote-added', (e: DomainEvent) => this.onVoteAdded(e));
    this.logger.info('DiscussionService started — listening for task:created, discussion:vote-added');
  }

  // ─── Story 5.2: Auto-creation ──────────────────────────
  private async onTaskCreated(event: DomainEvent): Promise<void> {
    const { taskId, orgId, type } = event.payload as {
      taskId: string;
      orgId: string;
      type: string;
      parentId: string | null;
    };

    if (type !== 'epic') return;

    const existing = await this.discussionRepo.findGroupByTaskNodeId(taskId);
    if (existing) return;

    const group = await this.discussionRepo.createGroup({ taskNodeId: taskId, orgId });
    this.logger.info('Discussion group auto-created for epic', { groupId: group.id, taskId });

    this.eventBus.emit({
      type: 'discussion:group-created',
      timestamp: new Date().toISOString(),
      payload: { groupId: group.id, taskNodeId: taskId, orgId },
    });
  }

  // ─── Story 5.3 & 5.4: Consensus wiring ────────────────
  private async onVoteAdded(event: DomainEvent): Promise<void> {
    const { groupId } = event.payload as { groupId: string };

    const group = await this.discussionRepo.findGroupById(groupId);
    if (!group) return;

    const result = await this.consensusDetector.evaluate(groupId);
    this.logger.debug('Consensus evaluation result', { groupId, result });

    switch (result.outcome) {
      case 'approved':
        await this.handleApproved(group);
        break;
      case 'revision':
        await this.handleRevision(group, result.feedback);
        break;
      case 'delegated':
        await this.handleDelegated(group, result.targetRoleId);
        break;
      case 'disputed':
        await this.handleDisputed(group);
        break;
      case 'pending':
        break;
    }
  }

  private async handleApproved(group: DiscussionGroup): Promise<void> {
    const task = await this.taskRepo.findById(group.taskNodeId);
    if (!task) return;

    // Check if the reviewer role requires human approval
    if (task.assigneeRoleId) {
      const role = await this.roleRepo.findById(task.assigneeRoleId);
      if (role?.requiresHumanApproval && task.status === 'awaiting_review') {
        this.logger.info('Consensus reached but human approval required', {
          taskId: task.id,
          roleId: role.id,
        });
        return; // Leave in awaiting_review for human decision
      }
    }

    await this.taskStateMachine.transition(task.id, 'approved');
    this.reviseCounts.delete(task.id);
    this.logger.info('Task approved via consensus', { taskId: task.id });
  }

  private async handleRevision(group: DiscussionGroup, feedback: string): Promise<void> {
    const task = await this.taskRepo.findById(group.taskNodeId);
    if (!task) return;

    const count = (this.reviseCounts.get(task.id) ?? 0) + 1;
    this.reviseCounts.set(task.id, count);

    if (count >= this.config.execution.maxReviseAttempts) {
      this.logger.warn('REVISE cycle limit reached, escalating', {
        taskId: task.id,
        count,
      });
      this.eventBus.emit({
        type: 'circuit-breaker:revise-limit',
        timestamp: new Date().toISOString(),
        payload: { taskId: task.id, orgId: group.orgId, count },
      });
      // Escalate to parent role
      if (task.assigneeRoleId) {
        const role = await this.roleRepo.findById(task.assigneeRoleId);
        if (role?.parentId) {
          this.eventBus.emit({
            type: 'wake:triggered',
            timestamp: new Date().toISOString(),
            payload: { roleId: role.parentId, orgId: group.orgId, trigger: 'retry_failed' as const },
          });
        }
      }
      return;
    }

    await this.taskStateMachine.transition(task.id, 'revision');
    this.logger.info('Task sent to revision', { taskId: task.id, round: count });

    // Wake assignee with revision feedback
    if (task.assigneeRoleId) {
      this.eventBus.emit({
        type: 'wake:triggered',
        timestamp: new Date().toISOString(),
        payload: {
          roleId: task.assigneeRoleId,
          orgId: group.orgId,
          trigger: 'review_revise' as const,
        },
      });
    }
  }

  private async handleDelegated(group: DiscussionGroup, targetRoleId: string): Promise<void> {
    const task = await this.taskRepo.findById(group.taskNodeId);
    if (!task) return;

    await this.taskStateMachine.transition(task.id, 'blocked');
    this.logger.info('Task blocked due to delegation', { taskId: task.id, targetRoleId });

    this.eventBus.emit({
      type: 'wake:triggered',
      timestamp: new Date().toISOString(),
      payload: {
        roleId: targetRoleId,
        orgId: group.orgId,
        trigger: 'review_delegate' as const,
      },
    });
  }

  private async handleDisputed(group: DiscussionGroup): Promise<void> {
    const task = await this.taskRepo.findById(group.taskNodeId);
    if (!task || !task.assigneeRoleId) return;

    const role = await this.roleRepo.findById(task.assigneeRoleId);
    if (!role?.parentId) {
      this.logger.warn('Dispute detected but no parent role to escalate', {
        taskId: task.id,
      });
      return;
    }

    // Build dispute summary
    const stats = await this.discussionRepo.getVoteStats(group.id);
    const concernMessages = await this.discussionRepo.findMessagesByGroupId(group.id);
    const concerns = concernMessages.filter((m) => m.voteTag === 'CONCERN');

    const summary = [
      `Dispute detected in discussion for "${task.title}".`,
      `Vote stats: APPROVE=${stats.APPROVE}, REVISE=${stats.REVISE}, CONCERN=${stats.CONCERN}, DELEGATE=${stats.DELEGATE}`,
      `Concerns raised:`,
      ...concerns.map((c) => `- ${c.content}`),
    ].join('\n');

    // Store as summary
    await this.discussionRepo.updateGroupSummary(group.id, summary);

    this.logger.info('Dispute detected, escalating to parent role', {
      taskId: task.id,
      parentRoleId: role.parentId,
    });

    this.eventBus.emit({
      type: 'dispute:detected',
      timestamp: new Date().toISOString(),
      payload: {
        groupId: group.id,
        taskId: task.id,
        orgId: group.orgId,
        parentRoleId: role.parentId,
        summary,
      },
    });

    // Wake parent role
    this.eventBus.emit({
      type: 'wake:triggered',
      timestamp: new Date().toISOString(),
      payload: {
        roleId: role.parentId,
        orgId: group.orgId,
        trigger: 'dispute_detected' as const,
      },
    });
  }

  // ─── Story 5.5: Auto-summary ──────────────────────────
  async generateSummary(groupId: string): Promise<string> {
    const group = await this.discussionRepo.findGroupById(groupId);
    if (!group) return '';

    const recentMessages = await this.discussionRepo.findRecentMessages(groupId, 3);
    const stats = await this.discussionRepo.getVoteStats(groupId);

    const roleNames = new Map<string, string>();
    for (const msg of recentMessages) {
      if (msg.authorRoleId && !roleNames.has(msg.authorRoleId)) {
        const r = await this.roleRepo.findById(msg.authorRoleId);
        roleNames.set(msg.authorRoleId, r?.name ?? 'Unknown');
      }
    }

    const latestRevise = recentMessages.find((m) => m.voteTag === 'REVISE');

    const lines: string[] = [];
    lines.push(`Vote statistics: APPROVE=${stats.APPROVE}, REVISE=${stats.REVISE}, CONCERN=${stats.CONCERN}, DELEGATE=${stats.DELEGATE}`);

    if (latestRevise) {
      const author = latestRevise.authorRoleId ? (roleNames.get(latestRevise.authorRoleId) ?? 'Unknown') : 'System';
      lines.push(`Latest revision feedback from ${author}: ${latestRevise.content}`);
    }

    if (recentMessages.length > 0) {
      lines.push('Recent messages:');
      for (const msg of recentMessages) {
        const author = msg.authorRoleId ? (roleNames.get(msg.authorRoleId) ?? 'Unknown') : 'System';
        const tag = msg.voteTag ? ` [${msg.voteTag}]` : '';
        lines.push(`  ${author}${tag}: ${msg.content}`);
      }
    }

    const summary = lines.join('\n');
    await this.discussionRepo.updateGroupSummary(groupId, summary);

    return summary;
  }

  // ─── Public API for IPC handlers ──────────────────────
  async findGroupsByOrgId(orgId: string): Promise<DiscussionGroup[]> {
    return this.discussionRepo.findGroupsByOrgId(orgId);
  }

  async findGroupByTaskNodeId(taskNodeId: string): Promise<DiscussionGroup | null> {
    return this.discussionRepo.findGroupByTaskNodeId(taskNodeId);
  }

  async findMessagesByGroupId(groupId: string): Promise<DiscussionMessage[]> {
    return this.discussionRepo.findMessagesByGroupId(groupId);
  }

  async getVoteStats(groupId: string): Promise<VoteStats> {
    return this.discussionRepo.getVoteStats(groupId);
  }

  async postMessage(input: {
    groupId: string;
    authorRoleId: string | null;
    authorType: AuthorType;
    content: string;
    voteTag: VoteTag;
  }): Promise<DiscussionMessage> {
    const message = await this.discussionRepo.postMessage(input);
    this.logger.info('Discussion message posted', {
      groupId: input.groupId,
      authorType: input.authorType,
      voteTag: input.voteTag,
    });

    // Emit general message event
    this.eventBus.emit({
      type: 'discussion:message-added',
      timestamp: new Date().toISOString(),
      payload: { groupId: input.groupId, messageId: message.id },
    });

    // If it's a vote, also emit specific vote event for consensus eval
    if (input.voteTag) {
      this.eventBus.emit({
        type: 'discussion:vote-added',
        timestamp: new Date().toISOString(),
        payload: {
          groupId: input.groupId,
          messageId: message.id,
          voteTag: input.voteTag,
          authorRoleId: input.authorRoleId,
        },
      });
    }

    return message;
  }
}
