import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { McpToolCallResult } from '@main/core/interfaces/i-mcp-tool-handler.js';
import type { VoteTag } from '@main/core/types/domain.types.js';
import type { TaskService } from '@main/application/tasks/task.service.js';
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
  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    private readonly taskService: TaskService,
  ) {}

  registerAll(registry: McpToolRegistry): void {
    registry.register('capibara_task_complete', (args) => this.taskComplete(args));
    registry.register('capibara_task_create_child', (args) => this.taskCreateChild(args));
    registry.register('capibara_discussion_post', (args) => this.discussionPost(args));
    registry.register('capibara_context_get_task', (args) => this.contextGetTask(args));
    registry.register('capibara_context_get_org_tree', (args) => this.contextGetOrgTree(args));
    registry.register('capibara_context_get_discussion_summary', (args) => this.contextGetDiscussionSummary(args));
    registry.register('capibara_escalate', (args) => this.escalate(args));
  }

  private async taskComplete(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const taskId = args.taskId as string;
    const summary = args.summary as string;
    const artifactPaths = args.artifactPaths as string[] | undefined;

    if (artifactPaths) {
      await this.taskRepo.setArtifactPaths(taskId, artifactPaths);
    }

    // Check current task status — it may have already been approved
    // via consensus voting before the CLI called task_complete.
    const currentTask = await this.taskRepo.findById(taskId);
    if (!currentTask) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    if (currentTask.status === 'approved' || currentTask.status === 'done') {
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
    const parentTask = await this.taskRepo.findById(args.parentTaskId as string);
    if (!parentTask) {
      return { success: false, error: 'Parent task not found' };
    }

    const childType = (args.type as string) ?? 'task';

    try {
      // Use TaskService for type hierarchy validation and proper event emission
      const child = await this.taskService.create({
        orgId: parentTask.orgId,
        parentId: parentTask.id,
        type: childType as any,
        title: args.title as string,
        description: (args.description as string) ?? '',
        assigneeRoleId: (args.assigneeRoleId as string) ?? null,
      });
      return { success: true, data: { taskId: child.id } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private async discussionPost(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const msg = await this.discussionRepo.postMessage({
      groupId: args.discussionGroupId as string,
      authorRoleId: (args.authorRoleId as string) ?? null,
      authorType: 'ai',
      content: args.content as string,
      voteTag: (args.voteTag as VoteTag) ?? null,
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

  private async contextGetTask(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const task = await this.taskRepo.findById(args.taskId as string);
    if (!task) return { success: false, error: 'Task not found' };
    return { success: true, data: task };
  }

  private async contextGetOrgTree(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const orgId = args.orgId as string;
    const roles = await this.roleRepo.findByOrgId(orgId);
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

    return { success: true, data: { orgId, roles: tree } };
  }

  private async contextGetDiscussionSummary(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const groupId = args.discussionGroupId as string;
    const stats = await this.discussionRepo.getVoteStats(groupId);
    const recent = await this.discussionRepo.findRecentMessages(groupId, 5);
    return { success: true, data: { stats, recentMessages: recent } };
  }

  private async escalate(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const taskId = args.taskId as string;
    const reason = args.reason as string;

    this.logger.warn('Task escalated', { taskId, reason });
    return { success: true, data: { taskId, escalated: true, reason } };
  }
}
