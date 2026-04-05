import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { PromptContext, DiscussionSummary } from '@main/core/interfaces/i-prompt-builder.js';
import type { TaskNode, Role, Skill, WakeTrigger } from '@main/core/types/domain.types.js';
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

    // When woken for review, find child tasks awaiting review
    let childrenAwaitingReview: TaskNode[] = [];
    if (trigger === 'review_requested') {
      const children = await this.taskRepo.findByParentId(taskId);
      childrenAwaitingReview = children.filter((c) => c.status === 'awaiting_review');
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
      conversationContext,
      conversationWorkflow,
    };
  }

  private async resolveSkills(skillIds: string[]): Promise<Skill[]> {
    const results = await Promise.all(
      skillIds.map((id) => this.skillRepo.findById(id)),
    );
    return results.filter((s): s is Skill => s !== null);
  }

  private async buildDiscussionSummary(task: TaskNode): Promise<DiscussionSummary | null> {
    // Walk up the task tree to find the nearest discussion group (story or epic)
    const group = await this.findNearestDiscussionGroup(task);
    if (!group) return null;

    const recentMessages = await this.discussionRepo.findRecentMessages(group.id, 3);
    const voteStats = await this.discussionRepo.getVoteStats(group.id);

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
    };
  }

  /** Walk up the task tree to find the nearest discussion group (story or epic). */
  private async findNearestDiscussionGroup(task: TaskNode): Promise<{ id: string } | null> {
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
