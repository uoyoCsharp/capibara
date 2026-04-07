import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { PromptContext, DiscussionSummary, ReviewableChild, DecompositionDeliverable, LeafDeliverable } from '@main/core/interfaces/i-prompt-builder.js';
import type { TaskNode, DiscussionGroup, Role, Skill, WakeTrigger } from '@main/core/types/domain.types.js';
import type { ConversationContextBuilder } from '../conversation/conversation-context.builder.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  RUN_REPO_TOKEN,
} from '@main/core/tokens.js';
import { OrgContext } from './org.context.js';

/**
 * Builds the full execution context needed to compose a prompt for a given Run.
 */
@injectable()
export class ExecutionContext {
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;
  private conversationContextBuilder: ConversationContextBuilder | null = null;

  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    private readonly orgContext: OrgContext,
  ) {}

  setConversationDeps(
    repo: IConversationWorkflowRepository,
    contextBuilder: ConversationContextBuilder,
  ): void {
    this.conversationWorkflowRepo = repo;
    this.conversationContextBuilder = contextBuilder;
  }

  async buildPromptContext(roleId: string, taskId: string, trigger: WakeTrigger = 'task_assigned'): Promise<PromptContext> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new Error(`Role not found: ${roleId}`);

    const task = await this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const parentRole = await this.orgContext.getParentRole(roleId);
    const subordinates = await this.orgContext.getSubordinates(roleId);
    const peers = await this.orgContext.getPeers(roleId);

    const skills = await this.resolveSkills(role.skillIds);
    const discussionSummary = await this.buildDiscussionSummary(task);

    // Query children for review mode and revision sub-mode detection
    const children = await this.taskRepo.findByParentId(taskId);
    const hasChildren = children.length > 0;
    let childrenAwaitingReview: ReviewableChild[] = [];
    if (trigger === 'review_requested') {
      const rawChildren = children.filter((c) => c.status === 'awaiting_review');
      const roleNameCache = new Map<string, string>();
      childrenAwaitingReview = await Promise.all(
        rawChildren.map((c) => this.buildReviewableChild(c, roleNameCache)),
      );
    }

    // Build conversation context for conversation triggers
    let conversationContext: string | undefined;
    let conversationWorkflow: PromptContext['conversationWorkflow'];
    if ((trigger === 'discussion_reply' || trigger === 'conversation_escalation')
      && this.conversationWorkflowRepo && this.conversationContextBuilder) {
      try {
        const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskId);
        if (workflow) {
          conversationWorkflow = workflow;
          conversationContext = await this.conversationContextBuilder.build(workflow, trigger);
        }
      } catch (err) {
        // Graceful degradation: proceed without conversation context
        conversationContext = undefined;
        conversationWorkflow = undefined;
      }
    }

    return {
      role,
      task,
      trigger,
      parentRole,
      subordinates,
      peers,
      skills,
      discussionSummary,
      childrenAwaitingReview,
      hasChildren,
      conversationContext,
      conversationWorkflow,
    };
  }

  private async buildReviewableChild(
    child: TaskNode,
    roleNameCache: Map<string, string>,
  ): Promise<ReviewableChild> {
    // Resolve assignee name
    const assigneeRoleName = await this.resolveRoleName(child.assigneeRoleId, roleNameCache);

    // Build deliverable based on task type
    const isDecomposer = child.type === 'epic' || child.type === 'story';
    let deliverable: DecompositionDeliverable | LeafDeliverable;

    if (isDecomposer) {
      const grandchildren = await this.taskRepo.findByParentId(child.id);
      deliverable = {
        kind: 'decomposition',
        grandchildren: await Promise.all(grandchildren.map(async (gc) => ({
          title: gc.title,
          type: gc.type,
          status: gc.status,
          assigneeRoleName: await this.resolveRoleName(gc.assigneeRoleId, roleNameCache),
        }))),
      };
    } else {
      deliverable = {
        kind: 'leaf',
        artifactPaths: child.artifactPaths ?? [],
      };
    }

    // Extract work summary
    const workSummary = await this.extractWorkSummary(child);

    return { task: child, assigneeRoleName, deliverable, workSummary };
  }

  private async resolveRoleName(
    roleId: string | null,
    cache: Map<string, string>,
  ): Promise<string | null> {
    if (!roleId) return null;
    const cached = cache.get(roleId);
    if (cached) return cached;
    const role = await this.roleRepo.findById(roleId);
    const name = role?.name ?? null;
    if (name) cache.set(roleId, name);
    return name;
  }

  /**
   * Extract the latest work summary for a child task from discussion messages.
   * Looks for system-posted run summary messages (posted by DiscussionService.onRunCompleted).
   */
  private async extractWorkSummary(child: TaskNode): Promise<string | null> {
    if (!child.assigneeRoleId) return null;

    const group = await this.findNearestDiscussionGroup(child);
    if (!group) return null;

    const messages = await this.discussionRepo.findRecentMessages(group.id, 10);
    const summary = messages.find(
      (m) => m.authorType === 'system'
        && m.authorRoleId === child.assigneeRoleId
        && m.content.startsWith('**[') && m.content.includes('] Run '),
    );

    if (!summary) return null;

    const MAX_SUMMARY_LENGTH = 500;
    return summary.content.length > MAX_SUMMARY_LENGTH
      ? summary.content.slice(0, MAX_SUMMARY_LENGTH) + '...'
      : summary.content;
  }

  private async resolveSkills(skillIds: string[]): Promise<Skill[]> {
    const results = await Promise.all(
      skillIds.map((id) => this.skillRepo.findById(id)),
    );
    return results.filter((s): s is Skill => s !== null);
  }

  private async buildDiscussionSummary(task: TaskNode): Promise<DiscussionSummary | null> {
    const group = await this.findNearestDiscussionGroup(task);
    if (!group) return null;

    const recentMessages = await this.discussionRepo.findRecentMessages(group.id, 3);
    // Use current-round vote stats to avoid cross-round misattribution
    const voteStats = await this.discussionRepo.getVoteStatsForRound(group.id, group.currentRound);

    const roleNames = new Map<string, string>();
    for (const msg of recentMessages) {
      if (msg.authorRoleId && !roleNames.has(msg.authorRoleId)) {
        const r = await this.roleRepo.findById(msg.authorRoleId);
        roleNames.set(msg.authorRoleId, r?.name ?? 'Unknown');
      }
    }

    const latestReviseMsg = recentMessages.find((m) => m.voteTag === 'REVISE');

    return {
      groupId: group.id,
      recentMessages: recentMessages.map((m) => ({
        authorName: m.authorRoleId ? (roleNames.get(m.authorRoleId) ?? 'Unknown') : 'System',
        content: m.content,
        voteTag: m.voteTag,
      })),
      voteStats,
      latestReviseFeedback: latestReviseMsg?.content ?? null,
      disputeSummary: group.summary,
    };
  }

  /** Walk up the task tree to find the nearest discussion group (story or epic). */
  private async findNearestDiscussionGroup(task: TaskNode): Promise<DiscussionGroup | null> {
    let currentId: string | null = (task.type === 'story' || task.type === 'epic') ? task.id : task.parentId;
    while (currentId) {
      const t = await this.taskRepo.findById(currentId);
      if (!t) return null;
      if (t.type === 'story' || t.type === 'epic') {
        const group = await this.discussionRepo.findGroupByTaskNodeId(t.id);
        if (group) return group;
      }
      currentId = t.parentId;
    }
    return null;
  }
}
