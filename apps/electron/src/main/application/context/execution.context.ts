import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { ISettingsRepository } from '@main/core/interfaces/i-settings.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { PromptContext, DiscussionSummary, ReviewableChild, DecompositionDeliverable, LeafDeliverable, PlanningPromptContext, PriorWorkContext, SiblingTaskInfo } from '@main/core/interfaces/i-prompt-builder.js';
import type { TaskNode, DiscussionGroup, Role, Skill, WakeTrigger } from '@main/core/types/domain.types.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { ConversationContextBuilder } from '../conversation/conversation-context.builder.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  SETTINGS_REPO_TOKEN,
} from '@main/core/tokens.js';
import { OrgContext } from './org.context.js';

/**
 * Builds the full execution context needed to compose a prompt for a given Run.
 */
@injectable()
export class ExecutionContext {
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;
  private conversationContextBuilder: ConversationContextBuilder | null = null;
  private workflowEngine!: IWorkflowEngine;

  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(SETTINGS_REPO_TOKEN) private readonly settingsRepo: ISettingsRepository,
    private readonly orgContext: OrgContext,
  ) {}

  setConversationDeps(
    repo: IConversationWorkflowRepository,
    contextBuilder: ConversationContextBuilder,
  ): void {
    this.conversationWorkflowRepo = repo;
    this.conversationContextBuilder = contextBuilder;
  }

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  async buildPromptContext(
    roleId: string,
    taskId: string,
    trigger: WakeTrigger = 'task_assigned',
    planningContext?: PlanningPromptContext,
  ): Promise<PromptContext> {
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
      const reviewChecks = await Promise.all(children.map(async (c) => ({
        child: c,
        isReview: await this.workflowEngine.isReviewStatus(c.orgId, c.status),
      })));
      const rawChildren = reviewChecks.filter((r) => r.isReview).map((r) => r.child);
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

    // Fetch organization for custom instructions injection (graceful degradation)
    let organization: PromptContext['organization'];
    try {
      organization = await this.orgContext.getOrganization(task.orgId);
    } catch {
      organization = undefined;
    }

    // Fetch workflow type definitions for schema-driven prompt construction
    const taskTypeDef = await this.workflowEngine.getItemTypeDefinition(task.orgId, task.type);
    const allItemTypes = await this.workflowEngine.getAllItemTypes(task.orgId);
    const isTaskTerminal = await this.workflowEngine.isTerminalStatus(task.orgId, task.status);

    // OPT-03: Build prior work context for revision scenarios
    let priorWork: PriorWorkContext | undefined;
    if (trigger === 'review_revise') {
      priorWork = await this.buildPriorWorkContext(task, taskTypeDef);
    }

    // OPT-04: Build subordinate skill descriptions for decomposition/assignment
    let subordinateSkills: Map<string, string[]> | undefined;
    if (taskTypeDef?.canDecompose) {
      subordinateSkills = await this.buildSubordinateSkills(subordinates);
    }

    // Resolve communication language preference
    let communicationLanguage: string | undefined;
    try {
      communicationLanguage = await this.settingsRepo.get('locale') ?? undefined;
    } catch { /* default */ }

    // OPT-10: Build execution sequence context (sibling tasks + parent task info)
    const { siblingTasks, parentTask: parentTaskInfo } = await this.buildExecutionSequence(task);

    return {
      organization,
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
      taskTypeDef,
      allItemTypes,
      isTaskTerminal,
      planningContext,
      priorWork,
      subordinateSkills,
      communicationLanguage,
      siblingTasks,
      parentTask: parentTaskInfo,
    };
  }

  private async buildReviewableChild(
    child: TaskNode,
    roleNameCache: Map<string, string>,
  ): Promise<ReviewableChild> {
    // Resolve assignee name
    const assigneeRoleName = await this.resolveRoleName(child.assigneeRoleId, roleNameCache);

    // Build deliverable based on task type (schema-driven)
    const childTypeDef = await this.workflowEngine.getItemTypeDefinition(child.orgId, child.type);
    const isDecomposer = childTypeDef?.canDecompose ?? false;
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
        && m.content.startsWith('**['),
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

  /**
   * OPT-03: Build prior work context for revision scenarios.
   * Extracts last run summary, artifact paths, and proposed plan from task/discussion data.
   */
  private async buildPriorWorkContext(
    task: TaskNode,
    taskTypeDef: import('@main/core/types/workflow-schema.types.js').WorkItemTypeDefinition | null | undefined,
  ): Promise<PriorWorkContext> {
    // Artifact paths from the task itself
    const artifactPaths = task.artifactPaths ?? [];

    // Last run summary from discussion messages
    const lastRunSummary = await this.extractWorkSummary(task);

    // For decomposer tasks: extract the proposed plan from discussion
    let proposedPlan: string | null = null;
    const isDecomposer = taskTypeDef?.canDecompose ?? false;
    if (isDecomposer) {
      const group = await this.findNearestDiscussionGroup(task);
      if (group && task.assigneeRoleId) {
        const messages = await this.discussionRepo.findRecentMessages(group.id, 10);
        // Find the most recent non-vote message from the assignee (the proposed plan)
        const planMsg = messages.find(
          (m) => m.authorRoleId === task.assigneeRoleId && !m.voteTag,
        );
        if (planMsg) {
          proposedPlan = planMsg.content;
        }
      }
    }

    return { lastRunSummary, artifactPaths, proposedPlan };
  }

  /**
   * OPT-04: Build subordinate skill descriptions for decomposition assignment guidance.
   */
  private async buildSubordinateSkills(subordinates: Role[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    for (const sub of subordinates) {
      if (sub.skillIds.length === 0) continue;
      const descriptions: string[] = [];
      for (const skillId of sub.skillIds) {
        const skill = await this.skillRepo.findById(skillId);
        if (skill) descriptions.push(skill.description);
      }
      if (descriptions.length > 0) {
        result.set(sub.id, descriptions);
      }
    }
    return result;
  }

  /**
   * OPT-10: Build execution sequence context — sibling tasks and parent task info.
   * Only populated when the task has a parent (i.e., is part of a decomposition).
   */
  private async buildExecutionSequence(
    task: TaskNode,
  ): Promise<{ siblingTasks?: SiblingTaskInfo[]; parentTask?: PromptContext['parentTask'] }> {
    if (!task.parentId) return {};

    const parentTask = await this.taskRepo.findById(task.parentId);
    if (!parentTask) return {};

    const siblings = await this.taskRepo.findByParentId(task.parentId);
    if (siblings.length <= 1) return {};

    const roleNameCache = new Map<string, string>();
    const MAX_SUMMARY_LENGTH = 300;

    const siblingTasks: SiblingTaskInfo[] = await Promise.all(
      siblings.map(async (s) => {
        const isCurrent = s.id === task.id;
        const assigneeRoleName = await this.resolveRoleName(s.assigneeRoleId, roleNameCache);

        // Only extract work summaries for completed sibling tasks (not current)
        let workSummary: string | null = null;
        if (!isCurrent) {
          const isTerminal = await this.workflowEngine.isTerminalStatus(s.orgId, s.status);
          if (isTerminal) {
            workSummary = await this.extractWorkSummary(s);
            if (workSummary && workSummary.length > MAX_SUMMARY_LENGTH) {
              workSummary = workSummary.slice(0, MAX_SUMMARY_LENGTH) + '...';
            }
          }
        }

        return {
          id: s.id,
          type: s.type,
          title: s.title,
          status: s.status,
          assigneeRoleName,
          workSummary,
          isCurrent,
        };
      }),
    );

    return {
      siblingTasks,
      parentTask: {
        title: parentTask.title,
        type: parentTask.type,
        status: parentTask.status,
      },
    };
  }

  /** Walk up the task tree to find the nearest discussion group (schema-driven via hasDiscussionGroup). */
  private async findNearestDiscussionGroup(task: TaskNode): Promise<DiscussionGroup | null> {
    const hasDiscussion = (await this.workflowEngine.getItemTypeDefinition(task.orgId, task.type))?.hasDiscussionGroup ?? false;
    let currentId: string | null = hasDiscussion ? task.id : task.parentId;
    while (currentId) {
      const t = await this.taskRepo.findById(currentId);
      if (!t) return null;
      const typeDef = await this.workflowEngine.getItemTypeDefinition(t.orgId, t.type);
      if (typeDef?.hasDiscussionGroup) {
        const group = await this.discussionRepo.findGroupByTaskNodeId(t.id);
        if (group) return group;
      }
      currentId = t.parentId;
    }
    return null;
  }
}
