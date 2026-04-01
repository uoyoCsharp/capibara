import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { McpToolCallResult } from '@main/core/interfaces/i-mcp-tool-handler.js';
import type { VoteTag } from '@main/core/types/domain.types.js';
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
  ) {}

  registerAll(registry: McpToolRegistry): void {
    registry.register('capibara_task_complete', (args) => this.taskComplete(args));
    registry.register('capibara_task_create_subtask', (args) => this.taskCreateSubtask(args));
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

    await this.taskRepo.updateStatus(taskId, 'awaiting_review');

    const task = await this.taskRepo.findById(taskId);
    this.eventBus.emit({
      type: 'task:completed',
      timestamp: new Date().toISOString(),
      payload: { taskId, orgId: task?.orgId, summary },
    });

    return { success: true, data: { taskId, status: 'awaiting_review' } };
  }

  private async taskCreateSubtask(args: Record<string, unknown>): Promise<McpToolCallResult> {
    const parentTask = await this.taskRepo.findById(args.parentTaskId as string);
    if (!parentTask) {
      return { success: false, error: 'Parent task not found' };
    }

    const subtask = await this.taskRepo.create({
      orgId: parentTask.orgId,
      parentId: parentTask.id,
      type: (args.type as string) as 'task' | 'subtask',
      title: args.title as string,
      description: args.description as string,
      assigneeRoleId: (args.assigneeRoleId as string) ?? null,
      depth: parentTask.depth + 1,
    });

    this.eventBus.emit({
      type: 'task:created',
      timestamp: new Date().toISOString(),
      payload: { taskId: subtask.id, orgId: subtask.orgId },
    });

    return { success: true, data: { taskId: subtask.id } };
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
