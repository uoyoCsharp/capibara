import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { McpToolCallResult } from '@main/core/interfaces/i-mcp-tool-handler.js';
import type { IConversationWorkflowService } from '@main/core/interfaces/i-conversation-workflow.service.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { VoteTag } from '@main/core/types/domain.types.js';
import type { RecipientTarget } from '@main/core/types/conversation.types.js';
import type { TaskService } from '@main/application/tasks/task.service.js';
import type { ConversationEventLogger } from '@main/infrastructure/persistence/sqlite/conversation-event.logger.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';
import { McpToolRegistry } from './mcp-tool-registry.js';

/**
 * Registers concrete MCP tool handlers.
 * See Architecture §7.3 — MCP Tools (MVP).
 */
@injectable()
export class McpToolHandlers {
  private conversationService: IConversationWorkflowService | null = null;
  private conversationWorkflowRepo: IConversationWorkflowRepository | null = null;
  private conversationEventLogger: ConversationEventLogger | null = null;

  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    private readonly taskService: TaskService,
  ) {}

  setConversationDeps(
    service: IConversationWorkflowService,
    repo: IConversationWorkflowRepository,
    eventLogger?: ConversationEventLogger,
  ): void {
    this.conversationService = service;
    this.conversationWorkflowRepo = repo;
    this.conversationEventLogger = eventLogger ?? null;
  }

  registerAll(registry: McpToolRegistry): void {
    registry.register('capibara_task_complete', (args) => this.taskComplete(args));
    registry.register('capibara_task_create_child', (args) => this.taskCreateChild(args));
    registry.register('capibara_discussion_post', (args) => this.discussionPost(args));
    registry.register('capibara_context', (args) => this.context(args));
    registry.register('capibara_task_review', (args) => this.taskReview(args));
    registry.register('capibara_conversation', (args) => this.conversation(args));
  }

  private async taskComplete(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const taskId = typeof args.taskId === 'string' ? args.taskId : '';
    if (!taskId) return { success: false, error: 'taskId is required and must be a string' };
    const summary = typeof args.summary === 'string' ? args.summary : '';
    const artifactPaths = Array.isArray(args.artifactPaths) ? args.artifactPaths as string[] : undefined;

    if (artifactPaths) {
      await this.taskRepo.setArtifactPaths(taskId, artifactPaths);
    }

    // Check current task status — it may have already been approved
    // via consensus voting before the CLI called task_complete.
    const currentTask = await this.taskRepo.findById(taskId);
    if (!currentTask) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    if (currentTask.status === 'approved' || currentTask.status === 'done' || currentTask.status === 'cancelled') {
      this.logger.info('task_complete called but task already in terminal state, skipping transition', {
        taskId,
        currentStatus: currentTask.status,
      });
      return { success: true, data: { taskId, status: currentTask.status } };
    }

    // Use TaskService to transition through the state machine.
    // This emits task:status-changed events and triggers auto-approval
    // for roles that don't require human approval.
    await this.taskService.updateStatus(taskId, 'awaiting_review');

    const task = await this.taskRepo.findById(taskId);
    return { success: true, data: { taskId, status: task?.status ?? 'awaiting_review' } };
  }

  private async taskCreateChild(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const parentTaskId = typeof args.parentTaskId === 'string' ? args.parentTaskId : '';
    if (!parentTaskId) return { success: false, error: 'parentTaskId is required and must be a string' };
    const title = typeof args.title === 'string' ? args.title : '';
    if (!title) return { success: false, error: 'title is required and must be a string' };

    const parentTask = await this.taskRepo.findById(parentTaskId);
    if (!parentTask) {
      return { success: false, error: 'Parent task not found' };
    }

    const validChildTypes = ['story', 'task', 'subtask', 'spike', 'bug', 'chore'];
    const childType = (typeof args.type === 'string' ? args.type : null) ?? 'task';
    if (!validChildTypes.includes(childType)) {
      return { success: false, error: `Invalid task type: "${childType}". Must be one of: ${validChildTypes.join(', ')}` };
    }

    try {
      // Use TaskService for type hierarchy validation and proper event emission
      const child = await this.taskService.create({
        orgId: parentTask.orgId,
        parentId: parentTask.id,
        type: childType as any,
        title,
        description: (typeof args.description === 'string' ? args.description : ''),
        assigneeRoleId: (typeof args.assigneeRoleId === 'string' ? args.assigneeRoleId : null),
      });
      return { success: true, data: { taskId: child.id } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private async discussionPost(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const groupId = typeof args.discussionGroupId === 'string' ? args.discussionGroupId : '';
    if (!groupId) return { success: false, error: 'discussionGroupId is required and must be a string' };
    const content = typeof args.content === 'string' ? args.content : '';
    if (!content) return { success: false, error: 'content is required and must be a string' };

    const validVoteTags = ['APPROVE', 'REVISE', 'CONCERN', 'DELEGATE'];
    const rawVoteTag = typeof args.voteTag === 'string' ? args.voteTag : null;
    if (rawVoteTag && !validVoteTags.includes(rawVoteTag)) {
      return { success: false, error: `Invalid voteTag: ${rawVoteTag}. Expected one of: ${validVoteTags.join(', ')}` };
    }

    const msg = await this.discussionRepo.postMessage({
      groupId,
      authorRoleId: (typeof args.authorRoleId === 'string' ? args.authorRoleId : null),
      authorType: 'ai',
      content,
      voteTag: (rawVoteTag as VoteTag) ?? null,
    });

    // Emit message event so UI updates in real time
    this.eventBus.emit({
      type: 'discussion:message-added',
      timestamp: new Date().toISOString(),
      payload: { groupId: msg.groupId, messageId: msg.id },
    });

    if (msg.voteTag) {
      this.eventBus.emit({
        type: 'discussion:vote-added',
        timestamp: new Date().toISOString(),
        payload: { groupId: msg.groupId, messageId: msg.id, voteTag: msg.voteTag, authorRoleId: msg.authorRoleId },
      });
    }

    return { success: true, data: { messageId: msg.id } };
  }

  private async context(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const query = typeof args.query === 'string' ? args.query : '';
    const id = typeof args.id === 'string' ? args.id : '';
    if (!id) return { success: false, error: 'id is required and must be a string' };

    switch (query) {
      case 'task': {
        const task = await this.taskRepo.findById(id);
        if (!task) return { success: false, error: 'Task not found' };
        return { success: true, data: task };
      }
      case 'org_tree': {
        const roles = await this.roleRepo.findByOrgId(id);
        if (!roles.length) return { success: false, error: 'No roles found for org' };
        const tree = roles.map((r) => ({
          id: r.id,
          name: r.name,
          parentId: r.parentId,
          status: r.status,
          canApprove: r.canApprove,
          canDelegate: r.canDelegate,
          requiresHumanApproval: r.requiresHumanApproval,
        }));
        return { success: true, data: { orgId: id, roles: tree } };
      }
      case 'discussion_summary': {
        const group = await this.discussionRepo.findGroupById(id);
        const currentRound = group?.currentRound ?? 0;
        const stats = await this.discussionRepo.getVoteStatsForRound(id, currentRound);
        const recent = await this.discussionRepo.findRecentMessages(id, 5);
        return { success: true, data: { stats, recentMessages: recent } };
      }
      default:
        return { success: false, error: 'query must be "task", "org_tree", or "discussion_summary"' };
    }
  }

  private async taskReview(args: Record<string, unknown>): Promise<McpToolCallResult> {
    // Input validation
    const taskId = typeof args.taskId === 'string' ? args.taskId : '';
    const decision = typeof args.decision === 'string' ? args.decision : '';
    const feedback = typeof args.feedback === 'string' ? args.feedback : '';
    const reviewerRoleId = typeof args.reviewerRoleId === 'string' ? args.reviewerRoleId : '';

    if (!taskId || !reviewerRoleId) {
      return { success: false, error: 'taskId and reviewerRoleId are required' };
    }
    if (decision !== 'approve' && decision !== 'revise') {
      return { success: false, error: 'decision must be "approve" or "revise"' };
    }
    if (decision === 'revise' && !feedback) {
      return { success: false, error: 'feedback is required when decision is "revise"' };
    }

    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    if (task.status !== 'awaiting_review') {
      return { success: false, error: `Task ${taskId} is not awaiting review (status: ${task.status})` };
    }

    // Authorization: reviewer must be the parent task's assignee
    if (task.parentId) {
      const parentTask = await this.taskRepo.findById(task.parentId);
      if (parentTask && parentTask.assigneeRoleId !== reviewerRoleId) {
        return { success: false, error: `Role ${reviewerRoleId} is not authorized to review this task (parent assignee: ${parentTask.assigneeRoleId})` };
      }
    }

    // Post review message to nearest discussion group for traceability
    const group = await this.findNearestDiscussionGroup(taskId);
    if (group) {
      const voteTag = decision === 'approve' ? 'APPROVE' : 'REVISE';
      const content = feedback || `Approved task "${task.title}"`;
      const msg = await this.discussionRepo.postMessage({
        groupId: group.id,
        authorRoleId: reviewerRoleId,
        authorType: 'ai',
        content,
        voteTag: voteTag as VoteTag,
      });

      this.eventBus.emit({
        type: 'discussion:message-added',
        timestamp: new Date().toISOString(),
        payload: { groupId: group.id, messageId: msg.id },
      });
    }

    if (decision === 'approve') {
      await this.taskService.updateStatus(taskId, 'approved');
      this.logger.info('Task approved by AI reviewer', { taskId, reviewerRoleId });
      return { success: true, data: { taskId, status: 'approved' } };
    } else {
      await this.taskService.updateStatus(taskId, 'revision');
      this.logger.info('Task sent to revision by AI reviewer', { taskId, reviewerRoleId, feedback });

      // Wake the original assignee to address the revision
      if (task.assigneeRoleId) {
        this.eventBus.emit({
          type: 'wake:triggered',
          timestamp: new Date().toISOString(),
          payload: {
            roleId: task.assigneeRoleId,
            orgId: task.orgId,
            trigger: 'review_revise' as const,
          },
        });
      } else {
        this.logger.warn('Task has no assignee to wake for revision', { taskId });
        return { success: true, data: { taskId, status: 'revision', feedback, warning: 'No assignee to wake for revision' } };
      }

      return { success: true, data: { taskId, status: 'revision', feedback } };
    }
  }

  /** Walk up task tree to find nearest discussion group (story or epic). */
  private async findNearestDiscussionGroup(taskId: string): Promise<{ id: string; currentRound: number } | null> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) return null;
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

  private async conversation(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const action = typeof args.action === 'string' ? args.action : '';
    if (action !== 'ask' && action !== 'resolve') {
      return { success: false, error: 'action must be "ask" or "resolve"' };
    }

    if (action === 'ask') {
      return this.askQuestion(args);
    } else {
      return this.markConversationResolved(args);
    }
  }

  private async askQuestion(args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!this.conversationService) {
      return { success: false, error: 'Conversation service not initialized' };
    }

    const taskId = typeof args.taskId === 'string' ? args.taskId : '';
    const question = typeof args.question === 'string' ? args.question : '';
    const urgency = (args.urgency === 'urgent' ? 'urgent' : 'normal') as 'normal' | 'urgent';

    if (!taskId || !question) {
      return { success: false, error: 'taskId and question are required' };
    }

    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    // Parse recipientTarget
    let recipientTarget: RecipientTarget = { type: 'supervisor' };
    if (args.recipientTarget) {
      const rt = args.recipientTarget as { type: string; roleId?: string };
      if (rt.type === 'human') {
        recipientTarget = { type: 'human' };
      } else if (rt.type === 'role') {
        if (!rt.roleId) {
          return { success: false, error: 'recipientTarget.roleId is required when type is "role"' };
        }
        recipientTarget = { type: 'role', roleId: rt.roleId };
      } else if (rt.type === 'any') {
        recipientTarget = { type: 'any' };
      } else if (rt.type !== 'supervisor') {
        return { success: false, error: `Invalid recipientTarget.type: "${rt.type}". Must be one of: supervisor, human, role, any` };
      }
    }

    // Resolve current run for this task
    const runId = (args._runId as string) ?? '';
    const sessionId = (args._sessionId as string) ?? null;

    const workflow = await this.conversationService.createWorkflow({
      orgId: task.orgId,
      taskNodeId: taskId,
      askingRoleId: (args._roleId as string) ?? task.assigneeRoleId ?? '',
      askingRunId: runId,
      askingSessionId: sessionId,
      question,
      recipientTarget,
      urgency,
    });

    return {
      success: true,
      data: {
        status: 'question_posted',
        workflowId: workflow.id,
        respondentInfo: {
          roleId: workflow.respondentRoleId,
          type: workflow.respondentType,
        },
        timeoutAt: workflow.timeoutAt,
      },
    };
  }

  private async markConversationResolved(args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!this.conversationService || !this.conversationWorkflowRepo) {
      return { success: false, error: 'Conversation service not initialized' };
    }

    const taskId = typeof args.taskId === 'string' ? args.taskId : '';
    const summary = typeof args.summary === 'string' ? args.summary : undefined;

    if (!taskId) {
      return { success: false, error: 'taskId is required and must be a string' };
    }

    const roleId = typeof args._roleId === 'string' ? args._roleId : '';

    // Find active workflow for this task where asking role matches
    const workflow = await this.conversationWorkflowRepo.findActiveByRoleAndTask(roleId, taskId);
    if (!workflow) {
      return { success: false, error: 'No active conversation found for this task and role' };
    }

    // Only 'resumed' state can transition to 'resolved'
    if (workflow.state !== 'resumed') {
      return { success: false, error: `Cannot resolve conversation in '${workflow.state}' state (must be 'resumed')` };
    }

    // Transition to resolved
    const now = new Date().toISOString();
    await this.conversationWorkflowRepo.resolve(workflow.id, now);

    // Post resolution message if summary provided
    if (summary) {
      await this.discussionRepo.postMessage({
        groupId: workflow.discussionGroupId,
        authorRoleId: roleId || null,
        authorType: 'ai',
        content: summary,
        voteTag: null,
        intent: 'resolution',
      });
    }

    // Emit event
    this.eventBus.emit({
      type: 'conversation:resolved',
      timestamp: now,
      payload: {
        workflowId: workflow.id,
        orgId: workflow.orgId,
        summary: summary ?? null,
      },
    });

    // Log audit event
    this.conversationEventLogger?.log(workflow.id, 'resolved', {
      summary: summary ?? null,
      resolvedBy: roleId || 'unknown',
    });

    return { success: true, data: { workflowId: workflow.id, status: 'resolved' } };
  }
}
