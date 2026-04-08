import { injectable, inject } from 'tsyringe';
import type { IDiscussionRepository, VoteStats } from '@main/core/interfaces/i-discussion.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IConversationWorkflowService } from '@main/core/interfaces/i-conversation-workflow.service.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import type { DiscussionGroup, DiscussionMessage, AuthorType, VoteTag, MessageIntent } from '@main/core/types/domain.types.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  DISCUSSION_REPO_TOKEN,
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
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
  // reviseCounts now persisted in discussion_groups.revise_count (Bug 3 / Risk 9)
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;
  private conversationWorkflowService: IConversationWorkflowService | null = null;

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    private readonly consensusDetector: ConsensusDetector,
    private readonly taskStateMachine: TaskStateMachine,
  ) { }

  setConversationDeps(
    repo: IConversationWorkflowRepository,
    service: IConversationWorkflowService,
  ): void {
    this.conversationWorkflowRepo = repo;
    this.conversationWorkflowService = service;
  }

  /** Subscribe to domain events for auto-creation, consensus evaluation, and run summaries. */
  start(): void {
    this.eventBus.on('task:created', (e: DomainEvent) => this.onTaskCreated(e));
    this.eventBus.on('discussion:vote-added', (e: DomainEvent) => this.onVoteAdded(e));
    this.eventBus.on('run:succeeded', (e: DomainEvent) => void this.onRunCompleted(e));
    this.eventBus.on('run:failed', (e: DomainEvent) => void this.onRunCompleted(e));
    this.eventBus.on('discussion:message-added', (e: DomainEvent) => void this.onMessageAdded(e));
    this.logger.info('DiscussionService started — listening for task:created, discussion:vote-added, run:succeeded, run:failed, discussion:message-added');
  }

  /** Detect conversation replies when a message is added to a discussion group */
  private async onMessageAdded(event: DomainEvent): Promise<void> {
    if (!this.conversationWorkflowRepo || !this.conversationWorkflowService) return;

    const { groupId, messageId } = event.payload as { groupId: string; messageId: string };
    if (!groupId || !messageId) return;

    try {
      // Check if there's an active conversation workflow waiting for a reply in this group
      const workflow = await this.conversationWorkflowRepo.findWaitingByDiscussionGroup(groupId);
      if (!workflow) return;

      // Get the message to check if it's a reply
      const messages = await this.discussionRepo.findMessagesByGroupId(groupId);
      const message = messages.find((m) => m.id === messageId);
      if (!message) return;

      // Don't treat the asking role's own messages as replies
      if (message.authorRoleId === workflow.askingRoleId) return;

      // Check if this message is a reply:
      // 1. Message has intent='reply'
      // 2. OR message author matches the expected respondent
      // 3. OR message is from authorType='human' and not a vote (humans can always intervene — Story 12.6)
      const isReply =
        message.intent === 'reply' ||
        (message.authorRoleId === workflow.respondentRoleId) ||
        (message.authorType === 'human' && message.intent !== 'vote');

      if (isReply) {
        this.logger.info('Conversation reply detected', {
          workflowId: workflow.id,
          messageId,
          replierType: message.authorType,
        });
        await this.conversationWorkflowService.handleReply(workflow.id, messageId);
      }
    } catch (err) {
      this.logger.error('Failed to detect conversation reply', {
        groupId,
        messageId,
        error: String(err),
      });
    }
  }

  // ─── Story 5.2: Auto-creation ─────────
  // Bug 1 fix: create discussion groups for epic/story AND any task whose assignee requires human approval
  private async onTaskCreated(event: DomainEvent): Promise<void> {
    const { taskId, orgId, type } = event.payload as {
      taskId: string;
      orgId: string;
      type: string;
      parentId: string | null;
    };

    try {
      // Always create for epic/story (decomposition-level tasks)
      let shouldCreate = type === 'epic' || type === 'story';

      // Also create for any task type if the assigned role requires human approval
      if (!shouldCreate) {
        const task = await this.taskRepo.findById(taskId);
        if (task?.assigneeRoleId) {
          const role = await this.roleRepo.findById(task.assigneeRoleId);
          if (role?.requiresHumanApproval) {
            shouldCreate = true;
          }
        }
      }

      if (!shouldCreate) return;

      const existing = await this.discussionRepo.findGroupByTaskNodeId(taskId);
      if (existing) return;

      const group = await this.discussionRepo.createGroup({ taskNodeId: taskId, orgId });
      this.logger.info('Discussion group auto-created', { groupId: group.id, taskId, type });

      this.eventBus.emit({
        type: 'discussion:group-created',
        timestamp: new Date().toISOString(),
        payload: { groupId: group.id, taskNodeId: taskId, orgId },
      });
    } catch (err) {
      this.logger.error('Failed to auto-create discussion group', {
        taskId,
        orgId,
        type,
        error: String(err),
      });
    }
  }

  // ─── Run completion → post work summary to nearest discussion group ────────
  private async onRunCompleted(event: DomainEvent): Promise<void> {
    const payload = event.payload as {
      runId: string;
      roleId: string;
      orgId: string;
      taskNodeId: string;
      tokenCount?: number;
      summary?: string | null;
      error?: string;
    };

    try {
      // Only post to discussion when there is meaningful content (summary or error)
      const hasSummary = !!payload.summary?.trim();
      const hasError = !!payload.error?.trim();
      if (!hasSummary && !hasError) return;

      // Find the nearest discussion group by walking up the task tree (story or epic)
      const group = await this.findNearestDiscussionGroup(payload.taskNodeId);
      if (!group) {
        this.logger.warn('No discussion group found for run summary', {
          runId: payload.runId,
          taskNodeId: payload.taskNodeId,
        });
        return;
      }

      const role = await this.roleRepo.findById(payload.roleId);
      const roleName = role?.name ?? 'Unknown Role';
      const task = await this.taskRepo.findById(payload.taskNodeId);
      const taskTitle = task?.title ?? 'Unknown Task';

      let content: string;
      if (hasSummary) {
        content = `**[${taskTitle}]** ${roleName}:\n${payload.summary!.trim()}`;
      } else {
        content = `**[${taskTitle}]** ${roleName} run failed\nError: ${payload.error}`;
      }

      const postedMsg = await this.discussionRepo.postMessage({
        groupId: group.id,
        authorRoleId: payload.roleId,
        authorType: 'ai',
        content,
        voteTag: null,
      });

      this.logger.info('Run summary posted to discussion', {
        groupId: group.id,
        runId: payload.runId,
      });

      this.eventBus.emit({
        type: 'discussion:message-added',
        timestamp: new Date().toISOString(),
        payload: { groupId: group.id, messageId: postedMsg.id },
      });
    } catch (err) {
      this.logger.error('Failed to post run summary to discussion', {
        runId: payload.runId,
        taskNodeId: payload.taskNodeId,
        error: String(err),
      });
    }
  }

  /**
   * Walk up the task tree to find the nearest discussion group.
   * Discussion groups exist on epic and story tasks.
   * If the task itself is an epic or story, use its group directly.
   * Otherwise, walk up to find the nearest ancestor with a discussion group.
   */
  private async findNearestDiscussionGroup(taskNodeId: string): Promise<DiscussionGroup | null> {
    let currentId: string | null = taskNodeId;
    while (currentId) {
      const task = await this.taskRepo.findById(currentId);
      if (!task) return null;

      if (task.type === 'story' || task.type === 'epic') {
        const group = await this.discussionRepo.findGroupByTaskNodeId(task.id);
        if (group) return group;
      }
      currentId = task.parentId;
    }
    return null;
  }

  // ─── Story 5.3 & 5.4: Consensus wiring ────────────────
  private async onVoteAdded(event: DomainEvent): Promise<void> {
    const { groupId, voteTag, authorRoleId } = event.payload as {
      groupId: string;
      messageId: string;
      voteTag: string | null;
      authorRoleId: string | null;
    };

    try {
      const group = await this.discussionRepo.findGroupById(groupId);
      if (!group) return;

      // Check if this vote came from a human (authorRoleId is null for human votes)
      const isHumanVote = authorRoleId === null;

      // If a human directly votes APPROVE and requiresHumanApproval is set,
      // handle based on task state:
      // - awaiting_review: final approval (task_complete was called)
      // - in_progress: decomposition proposal approved → wake agent for Phase 2
      if (isHumanVote && voteTag === 'APPROVE') {
        const task = await this.taskRepo.findById(group.taskNodeId);
        if (task && task.assigneeRoleId) {
          const role = await this.roleRepo.findById(task.assigneeRoleId);
          if (role?.requiresHumanApproval) {
            if (task.status === 'in_progress') {
              // Phase 1 approval: decomposition plan approved, wake agent for Phase 2
              this.logger.info('Decomposition plan approved by human, waking agent for Phase 2', {
                taskId: task.id,
                roleId: role.id,
              });
              this.eventBus.emit({
                type: 'wake:triggered',
                timestamp: new Date().toISOString(),
                payload: {
                  roleId: task.assigneeRoleId,
                  orgId: group.orgId,
                  trigger: 'review_approve' as const,
                },
              });
              return;
            }
            if (task.status === 'awaiting_review') {
              // Final approval: task_complete was called, approve the task
              await this.taskStateMachine.transition(task.id, 'approved');
              await this.discussionRepo.resetReviseCount(group.id);
              this.logger.info('Task approved by human', { taskId: task.id });
              return;
            }
          }
        }
      }

      // If a human directly votes REVISE, trigger revision immediately
      if (isHumanVote && voteTag === 'REVISE') {
        const task = await this.taskRepo.findById(group.taskNodeId);
        if (!task) return;

        // Risk 12 fix: skip if task is already in revision state
        if (task.status === 'revision') {
          this.logger.debug('Human REVISE skipped: task already in revision', { taskId: task.id });
          return;
        }

        if (task.status === 'in_progress' && task.assigneeRoleId) {
          // Phase 1 revision: decomposition plan rejected, wake agent to re-propose
          this.logger.info('Decomposition plan revised by human, waking agent to re-propose', {
            taskId: task.id,
          });
          this.eventBus.emit({
            type: 'wake:triggered',
            timestamp: new Date().toISOString(),
            payload: {
              roleId: task.assigneeRoleId,
              orgId: group.orgId,
              trigger: 'review_revise' as const,
            },
          });
          return;
        }
        const latestMsg = await this.discussionRepo.findRecentMessages(groupId, 1);
        const feedback = latestMsg[0]?.content ?? '';
        await this.handleRevision(group, feedback, true);
        return;
      }

      // If a human directly votes DELEGATE, trigger delegation immediately
      // Bug 5 fix: read targetRoleId from metadata instead of regex on content
      if (isHumanVote && voteTag === 'DELEGATE') {
        const latestMsg = await this.discussionRepo.findRecentMessages(groupId, 1);
        const rawTarget = (latestMsg[0]?.metadata as Record<string, unknown> | null)?.targetRoleId;
        const targetRoleId = typeof rawTarget === 'string' ? rawTarget : '';
        if (targetRoleId) {
          await this.handleDelegated(group, targetRoleId);
        }
        return;
      }

      // For AI votes, use consensus detection as before
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
    } catch (err) {
      this.logger.error('Failed to process vote', {
        groupId,
        voteTag,
        error: String(err),
      });
    }
  }

  private async handleApproved(group: DiscussionGroup): Promise<void> {
    const task = await this.taskRepo.findById(group.taskNodeId);
    if (!task) return;

    // Skip if the task is already approved or in a terminal state
    if (task.status === 'approved' || task.status === 'done' || task.status === 'cancelled') {
      this.logger.debug('handleApproved skipped: task already in terminal state', {
        taskId: task.id,
        status: task.status,
      });
      return;
    }

    // Check if the reviewer role requires human approval
    if (task.assigneeRoleId) {
      const role = await this.roleRepo.findById(task.assigneeRoleId);
      if (role?.requiresHumanApproval && task.status === 'awaiting_review') {
        this.logger.info('Consensus reached but human approval required', {
          taskId: task.id,
          roleId: role.id,
        });
        this.eventBus.emit({
          type: 'approval:required',
          timestamp: new Date().toISOString(),
          payload: {
            taskId: task.id,
            taskTitle: task.title,
            orgId: task.orgId,
            roleId: role.id,
            roleName: role.name,
            groupId: group.id,
          },
        });
        return; // Leave in awaiting_review for human decision
      }
    }

    await this.taskStateMachine.transition(task.id, 'approved');
    await this.discussionRepo.resetReviseCount(group.id);
    this.logger.info('Task approved via consensus', { taskId: task.id });
  }

  private async handleRevision(group: DiscussionGroup, feedback: string, isHuman = false): Promise<void> {
    const task = await this.taskRepo.findById(group.taskNodeId);
    if (!task) return;

    // Bug 3 / Risk 9 fix: use persisted revise count
    const count = await this.discussionRepo.incrementReviseCount(group.id);

    // Circuit breaker only applies to AI-to-AI revise loops; human feedback is always allowed
    if (!isHuman && count >= this.config.execution.maxReviseAttempts) {
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
    // Bug 3 fix: increment round so next votes start fresh
    await this.discussionRepo.incrementRound(group.id);
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

    // Build dispute summary (P4: use round-scoped stats)
    const stats = await this.discussionRepo.getVoteStatsForRound(group.id, group.currentRound);
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
    const stats = await this.discussionRepo.getVoteStatsForRound(groupId, group.currentRound);

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
    const group = await this.discussionRepo.findGroupById(groupId);
    if (!group) {
      return { APPROVE: 0, REVISE: 0, CONCERN: 0, DELEGATE: 0 };
    }
    return this.discussionRepo.getVoteStatsForRound(groupId, group.currentRound);
  }

  async postMessage(input: {
    groupId: string;
    authorRoleId: string | null;
    authorType: AuthorType;
    content: string;
    voteTag: VoteTag;
    metadata?: Record<string, unknown> | null;
    intent?: MessageIntent;
    inReplyToMessageId?: string | null;
  }): Promise<DiscussionMessage> {
    // Bug 3 fix: attach current review round to every message
    const group = await this.discussionRepo.findGroupById(input.groupId);
    const reviewRound = group?.currentRound ?? 1;
    const message = await this.discussionRepo.postMessage({ ...input, reviewRound });
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
