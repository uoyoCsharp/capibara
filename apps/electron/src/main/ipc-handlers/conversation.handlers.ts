import { ipcMain } from 'electron';
import { IPC_CHANNELS, cancelConversationSchema, resolveConversationSchema, replyToConversationSchema } from '@shared/contracts.js';
import type { DesktopResult, ConversationWorkflowRecord, ConversationMetricsRecord, ConversationAnalyticsRecord, ConversationTimeRange, ConversationInboxItem, GroupedConversationsResult } from '@shared/contracts.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IConversationWorkflowService } from '@main/core/interfaces/i-conversation-workflow.service.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ConversationEventLogger } from '@main/infrastructure/persistence/sqlite/conversation-event.logger.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

const TERMINAL_STATES: ReadonlySet<string> = new Set(['resolved', 'timed_out', 'cancelled']);

function toRecord(wf: import('@main/core/types/conversation.types.js').ConversationWorkflow): ConversationWorkflowRecord {
  return {
    id: wf.id,
    orgId: wf.orgId,
    taskNodeId: wf.taskNodeId,
    discussionGroupId: wf.discussionGroupId,
    askingRoleId: wf.askingRoleId,
    askingRunId: wf.askingRunId,
    respondentRoleId: wf.respondentRoleId,
    respondentType: wf.respondentType,
    state: wf.state,
    depth: wf.depth,
    parentWorkflowId: wf.parentWorkflowId,
    priority: wf.priority,
    timeoutAt: wf.timeoutAt,
    resolvedAt: wf.resolvedAt,
    createdAt: wf.createdAt,
    updatedAt: wf.updatedAt,
  };
}

export function registerConversationHandlers(
  workflowRepo: IConversationWorkflowRepository,
  discussionRepo: IDiscussionRepository,
  pendingWakeRepo: IPendingWakeRepository,
  eventBus: IEventBus,
  eventLogger: ConversationEventLogger,
  logger: ILogger,
  roleRepo: IRoleRepository,
  taskRepo: ITaskRepository,
  conversationService?: IConversationWorkflowService,
): void {
  // List resolved/terminal conversations for an org (for inbox history)
  ipcMain.handle(IPC_CHANNELS.getResolvedConversations, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const workflows = await workflowRepo.findByOrgId(orgId);
      const resolved = workflows
        .filter((wf) => TERMINAL_STATES.has(wf.state))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      if (resolved.length === 0) {
        return ok<ConversationInboxItem[]>([]);
      }

      // Group by taskNodeId — keep the latest workflow as representative
      const taskGroups = new Map<string, { latest: typeof resolved[0]; count: number }>();
      for (const wf of resolved) {
        const existing = taskGroups.get(wf.taskNodeId);
        if (!existing) {
          taskGroups.set(wf.taskNodeId, { latest: wf, count: 1 });
        } else {
          existing.count++;
          // Already sorted by updatedAt desc, so the first one is the latest
        }
      }

      const roles = await roleRepo.findByOrgId(orgId);
      const roleMap = new Map(roles.map((r) => [r.id, r]));
      const allTasks = await taskRepo.findByOrgId(orgId);
      const taskMap = new Map(allTasks.map((t) => [t.id, t]));

      const items: ConversationInboxItem[] = [...taskGroups.values()]
        .sort((a, b) => b.latest.updatedAt.localeCompare(a.latest.updatedAt))
        .slice(0, 50)
        .map(({ latest: wf, count }) => {
          const task = taskMap.get(wf.taskNodeId);
          const askingRole = roleMap.get(wf.askingRoleId);
          const respondentRole = wf.respondentRoleId ? roleMap.get(wf.respondentRoleId) : null;
          return {
            workflowId: wf.id,
            taskNodeId: wf.taskNodeId,
            taskTitle: task?.title ?? 'Unknown Task',
            discussionGroupId: wf.discussionGroupId,
            askingRoleId: wf.askingRoleId,
            askingRoleName: askingRole?.name ?? 'Unknown',
            respondentRoleId: wf.respondentRoleId,
            respondentRoleName: respondentRole?.name ?? null,
            respondentType: wf.respondentType,
            questionPreview: '',
            waitingSince: wf.updatedAt,
            priority: wf.priority,
            depth: wf.depth,
            conversationCount: count,
          };
        });

      return ok(items);
    } catch (err) {
      logger.error('Failed to get resolved conversations', { error: String(err) });
      return fail('INTERNAL', 'Failed to get resolved conversations');
    }
  });

  // List active conversations for an org
  ipcMain.handle(IPC_CHANNELS.getActiveConversations, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const workflows = await workflowRepo.findByOrgId(orgId);
      const active = workflows.filter((wf) => !TERMINAL_STATES.has(wf.state));
      return ok(active.map(toRecord));
    } catch (err) {
      logger.error('Failed to get active conversations', { error: String(err) });
      return fail('INTERNAL', 'Failed to get active conversations');
    }
  });

  // List grouped conversations for inbox (blocked vs monitoring)
  ipcMain.handle(IPC_CHANNELS.getGroupedConversations, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }

      const workflows = await workflowRepo.findByOrgId(orgId);
      const waiting = workflows.filter((wf) => wf.state === 'waiting_for_reply');

      if (waiting.length === 0) {
        return ok<GroupedConversationsResult>({ blocked: [], monitoring: [] });
      }

      // Batch-load roles and build lookup
      const roles = await roleRepo.findByOrgId(orgId);
      const roleMap = new Map(roles.map((r) => [r.id, r]));

      // Batch-load tasks for the org and build lookup
      const allTasks = await taskRepo.findByOrgId(orgId);
      const taskMap = new Map(allTasks.map((t) => [t.id, t]));

      // Batch-load messages for unique discussion groups that have questionMessageId
      const groupIdsWithQuestion = [...new Set(
        waiting.filter((wf) => wf.questionMessageId).map((wf) => wf.discussionGroupId),
      )];
      const messagesByGroup = new Map<string, Awaited<ReturnType<typeof discussionRepo.findMessagesByGroupId>>>();
      await Promise.all(groupIdsWithQuestion.map(async (gid) => {
        messagesByGroup.set(gid, await discussionRepo.findMessagesByGroupId(gid));
      }));

      const blocked: ConversationInboxItem[] = [];
      const monitoring: ConversationInboxItem[] = [];

      for (const wf of waiting) {
        // Get task title from pre-loaded map
        const task = taskMap.get(wf.taskNodeId);
        const taskTitle = task?.title ?? 'Unknown Task';

        // Get asking role name
        const askingRole = roleMap.get(wf.askingRoleId);
        const askingRoleName = askingRole?.name ?? 'Unknown';

        // Get respondent role name
        const respondentRole = wf.respondentRoleId ? roleMap.get(wf.respondentRoleId) : null;
        const respondentRoleName = respondentRole?.name ?? null;

        // Get last question message preview from pre-loaded messages
        let questionPreview = '';
        if (wf.questionMessageId) {
          const messages = messagesByGroup.get(wf.discussionGroupId);
          const questionMsg = messages?.find((m) => m.id === wf.questionMessageId);
          if (questionMsg) {
            questionPreview = questionMsg.content.slice(0, 200);
          }
        }

        const item: ConversationInboxItem = {
          workflowId: wf.id,
          taskNodeId: wf.taskNodeId,
          taskTitle,
          discussionGroupId: wf.discussionGroupId,
          askingRoleId: wf.askingRoleId,
          askingRoleName,
          respondentRoleId: wf.respondentRoleId,
          respondentRoleName,
          respondentType: wf.respondentType,
          questionPreview,
          waitingSince: wf.updatedAt,
          priority: wf.priority,
          depth: wf.depth,
        };

        // Blocked = respondent requires human approval (or respondentType is human)
        if (wf.respondentType === 'human' || (respondentRole && respondentRole.requiresHumanApproval)) {
          blocked.push(item);
        } else {
          monitoring.push(item);
        }
      }

      // Sort blocked by priority desc, then waitingSince asc (oldest first)
      blocked.sort((a, b) => b.priority - a.priority || a.waitingSince.localeCompare(b.waitingSince));
      monitoring.sort((a, b) => b.priority - a.priority || a.waitingSince.localeCompare(b.waitingSince));

      return ok<GroupedConversationsResult>({ blocked, monitoring });
    } catch (err) {
      logger.error('Failed to get grouped conversations', { error: String(err) });
      return fail('INTERNAL', 'Failed to get grouped conversations');
    }
  });

  // Get full conversation message history for a workflow
  ipcMain.handle(IPC_CHANNELS.getConversationHistory, async (_event, workflowId: unknown) => {
    try {
      if (typeof workflowId !== 'string' || !workflowId) {
        return fail('VALIDATION_ERROR', 'workflowId must be a non-empty string');
      }
      const workflow = await workflowRepo.findById(workflowId);
      if (!workflow) {
        return fail('NOT_FOUND', `Conversation workflow ${workflowId} not found`);
      }
      const messages = await discussionRepo.findMessagesByGroupId(workflow.discussionGroupId);
      // Filter to conversation-relevant messages
      const conversationMessages = messages.filter(
        (m) => m.intent === 'question' || m.intent === 'reply' || m.intent === 'escalation' || m.intent === 'resolution',
      );
      return ok(conversationMessages);
    } catch (err) {
      logger.error('Failed to get conversation history', { error: String(err) });
      return fail('INTERNAL', 'Failed to get conversation history');
    }
  });

  // Cancel an active conversation
  ipcMain.handle(IPC_CHANNELS.cancelConversation, async (_event, input: unknown) => {
    try {
      const parsed = cancelConversationSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { workflowId } = parsed.data;
      const workflow = await workflowRepo.findById(workflowId);
      if (!workflow) {
        return fail('NOT_FOUND', `Conversation workflow ${workflowId} not found`);
      }
      if (TERMINAL_STATES.has(workflow.state)) {
        return fail('INVALID_STATE', `Conversation is already in terminal state '${workflow.state}'`);
      }

      // Transition to cancelled
      await workflowRepo.updateState(workflowId, 'cancelled', 'Cancelled by human user');

      // Clean up pending wakes scoped to this conversation's task (not all wakes for the role)
      if (workflow.respondentRoleId && workflow.taskNodeId) {
        await pendingWakeRepo.consumeByRoleAndTask(workflow.respondentRoleId, workflow.taskNodeId);
      }

      // Log audit event
      eventLogger.log(workflowId, 'cancelled', { source: 'human', previousState: workflow.state });

      // Emit event
      eventBus.emit({
        type: 'conversation:cancelled',
        timestamp: new Date().toISOString(),
        payload: {
          workflowId: workflow.id,
          orgId: workflow.orgId,
          cancelledBy: 'human',
        },
      });

      logger.info('Conversation cancelled by human', { workflowId });
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to cancel conversation', { error: String(err) });
      return fail('INTERNAL', 'Failed to cancel conversation');
    }
  });

  // Resolve an active conversation (human forced termination)
  ipcMain.handle(IPC_CHANNELS.resolveConversation, async (_event, input: unknown) => {
    try {
      const parsed = resolveConversationSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { conversationWorkflowId } = parsed.data;
      const workflow = await workflowRepo.findById(conversationWorkflowId);
      if (!workflow) {
        return fail('NOT_FOUND', `Conversation workflow ${conversationWorkflowId} not found`);
      }
      if (TERMINAL_STATES.has(workflow.state)) {
        return fail('INVALID_STATE', `Conversation is already in terminal state '${workflow.state}'`);
      }

      // Transition to resolved
      await workflowRepo.updateState(conversationWorkflowId, 'resolved', 'Resolved by human');

      // Clean up all pending wakes associated with this conversation
      if (workflow.respondentRoleId && workflow.taskNodeId) {
        await pendingWakeRepo.consumeByRoleAndTask(workflow.respondentRoleId, workflow.taskNodeId);
      }

      // Log audit event
      eventLogger.log(conversationWorkflowId, 'human_resolved', {
        source: 'human',
        previousState: workflow.state,
      });

      // Emit event
      eventBus.emit({
        type: 'conversation:resolved',
        timestamp: new Date().toISOString(),
        payload: {
          workflowId: workflow.id,
          orgId: workflow.orgId,
        },
      });

      logger.info('Conversation resolved by human', { conversationWorkflowId });
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to resolve conversation', { error: String(err) });
      return fail('INTERNAL', 'Failed to resolve conversation');
    }
  });

  // Get conversation metrics for an org
  ipcMain.handle(IPC_CHANNELS.getConversationMetrics, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const workflows = await workflowRepo.findByOrgId(orgId);
      const total = workflows.length;
      const active = workflows.filter((wf) => !TERMINAL_STATES.has(wf.state)).length;
      const resolved = workflows.filter((wf) => wf.state === 'resolved').length;
      const escalated = workflows.filter((wf) => wf.state === 'escalated').length;
      const timedOut = workflows.filter((wf) => wf.state === 'timed_out').length;
      const cancelled = workflows.filter((wf) => wf.state === 'cancelled').length;

      // Calculate average resolution time for resolved workflows
      let avgResolutionTimeMs: number | null = null;
      const resolvedWorkflows = workflows.filter((wf) => wf.state === 'resolved' && wf.resolvedAt);
      if (resolvedWorkflows.length > 0) {
        const durations = resolvedWorkflows
          .map((wf) => {
            const created = new Date(wf.createdAt).getTime();
            const resolved = new Date(wf.resolvedAt!).getTime();
            return resolved - created;
          })
          .filter((d) => Number.isFinite(d) && d >= 0);
        if (durations.length > 0) {
          const totalMs = durations.reduce((sum, d) => sum + d, 0);
          avgResolutionTimeMs = Math.round(totalMs / durations.length);
        }
      }

      // Event-based metrics
      const workflowIds = workflows.map((wf) => wf.id);

      // Average response time from reply_posted events
      let avgResponseTimeMs: number | null = null;
      if (workflowIds.length > 0) {
        const events = eventLogger.findByWorkflowIds(workflowIds);
        const responseTimes: number[] = [];

        // Group events by workflowId for pairing
        const eventsByWf = new Map<string, typeof events>();
        for (const ev of events) {
          const arr = eventsByWf.get(ev.workflowId) ?? [];
          arr.push(ev);
          eventsByWf.set(ev.workflowId, arr);
        }
        for (const wfEvents of eventsByWf.values()) {
          const questionEv = wfEvents.find((e) => e.eventType === 'question_posted');
          const replyEv = wfEvents.find((e) => e.eventType === 'reply_posted');
          if (questionEv && replyEv) {
            const diff = new Date(replyEv.createdAt).getTime() - new Date(questionEv.createdAt).getTime();
            if (Number.isFinite(diff) && diff >= 0) responseTimes.push(diff);
          }
        }
        if (responseTimes.length > 0) {
          avgResponseTimeMs = Math.round(responseTimes.reduce((s, d) => s + d, 0) / responseTimes.length);
        }
      }

      // Rate metrics
      const escalationRate = total > 0 ? Math.round((escalated / total) * 10000) / 100 : 0;
      const timeoutRate = total > 0 ? Math.round((timedOut / total) * 10000) / 100 : 0;
      const humanCount = workflows.filter((wf) => wf.respondentType === 'human').length;
      const humanInterventionRate = total > 0 ? Math.round((humanCount / total) * 10000) / 100 : 0;

      // Average depth
      const avgDepth = total > 0
        ? Math.round((workflows.reduce((sum, wf) => sum + wf.depth, 0) / total) * 100) / 100
        : 0;

      // Cycle detection count from routing_decided events
      const cycleDetectionCount = workflowIds.length > 0
        ? eventLogger.countByTypeContaining(workflowIds, 'routing_decided', 'cycle')
        : 0;

      const metrics: ConversationMetricsRecord = {
        totalConversations: total,
        activeConversations: active,
        resolvedConversations: resolved,
        escalatedConversations: escalated,
        timedOutConversations: timedOut,
        cancelledConversations: cancelled,
        averageResolutionTimeMs: avgResolutionTimeMs,
        avgResponseTimeMs,
        escalationRate,
        timeoutRate,
        humanInterventionRate,
        avgDepth,
        cycleDetectionCount,
      };
      return ok(metrics);
    } catch (err) {
      logger.error('Failed to get conversation metrics', { error: String(err) });
      return fail('INTERNAL', 'Failed to get conversation metrics');
    }
  });

  // Get conversation events (audit trail) for a workflow
  ipcMain.handle(IPC_CHANNELS.getConversationEvents, async (_event, workflowId: unknown) => {
    try {
      if (typeof workflowId !== 'string' || !workflowId) {
        return fail('VALIDATION_ERROR', 'workflowId must be a non-empty string');
      }
      const events = eventLogger.findByWorkflowId(workflowId);
      return ok(events);
    } catch (err) {
      logger.error('Failed to get conversation events', { error: String(err) });
      return fail('INTERNAL', 'Failed to get conversation events');
    }
  });

  // Get conversation pattern analytics
  ipcMain.handle(IPC_CHANNELS.getConversationAnalytics, async (_event, orgId: unknown, timeRange: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const validRanges = ['7d', '30d', 'all'] as const;
      const range = (typeof timeRange === 'string' && validRanges.includes(timeRange as ConversationTimeRange))
        ? timeRange as ConversationTimeRange
        : 'all';

      let workflows = await workflowRepo.findByOrgId(orgId);

      // Apply time range filter
      if (range !== 'all') {
        const cutoff = Date.now() - (range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000);
        workflows = workflows.filter((wf) => new Date(wf.createdAt).getTime() >= cutoff);
      }

      // Build role name cache
      const orgRoles = await roleRepo.findByOrgId(orgId);
      const roleNameMap = new Map<string, string>();
      for (const r of orgRoles) roleNameMap.set(r.id, r.name);

      // Most asked roles (respondentRoleId frequency)
      const respondentCounts = new Map<string, number>();
      for (const wf of workflows) {
        if (wf.respondentRoleId) {
          respondentCounts.set(wf.respondentRoleId, (respondentCounts.get(wf.respondentRoleId) ?? 0) + 1);
        }
      }
      const mostAskedRoles = [...respondentCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([roleId, count]) => ({
          roleId,
          roleName: roleNameMap.get(roleId) ?? roleId.slice(0, 8),
          count,
        }));

      // Slowest responders (avg time from question_posted to reply_posted per respondent)
      const workflowIds = workflows.map((wf) => wf.id);
      const events = workflowIds.length > 0 ? eventLogger.findByWorkflowIds(workflowIds) : [];
      const eventsByWf = new Map<string, typeof events>();
      for (const ev of events) {
        const arr = eventsByWf.get(ev.workflowId) ?? [];
        arr.push(ev);
        eventsByWf.set(ev.workflowId, arr);
      }

      const responderTimes = new Map<string, number[]>();
      for (const wf of workflows) {
        if (!wf.respondentRoleId) continue;
        const wfEvents = eventsByWf.get(wf.id);
        if (!wfEvents) continue;
        const qEv = wfEvents.find((e) => e.eventType === 'question_posted');
        const rEv = wfEvents.find((e) => e.eventType === 'reply_posted');
        if (qEv && rEv) {
          const diff = new Date(rEv.createdAt).getTime() - new Date(qEv.createdAt).getTime();
          if (Number.isFinite(diff) && diff >= 0) {
            const arr = responderTimes.get(wf.respondentRoleId) ?? [];
            arr.push(diff);
            responderTimes.set(wf.respondentRoleId, arr);
          }
        }
      }
      const slowestResponders = [...responderTimes.entries()]
        .map(([roleId, times]) => ({
          roleId,
          roleName: roleNameMap.get(roleId) ?? roleId.slice(0, 8),
          avgResponseTimeMs: Math.round(times.reduce((s, t) => s + t, 0) / times.length),
        }))
        .sort((a, b) => b.avgResponseTimeMs - a.avgResponseTimeMs)
        .slice(0, 5);

      // Escalation hotspots (asking→respondent pairs for escalated workflows)
      const pairCounts = new Map<string, { fromId: string; toId: string; count: number }>();
      for (const wf of workflows) {
        if (wf.parentWorkflowId !== null && wf.respondentRoleId) {
          const key = `${wf.askingRoleId}:${wf.respondentRoleId}`;
          const existing = pairCounts.get(key);
          if (existing) existing.count++;
          else pairCounts.set(key, { fromId: wf.askingRoleId, toId: wf.respondentRoleId, count: 1 });
        }
      }
      const escalationHotspots = [...pairCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((p) => ({
          fromRoleId: p.fromId,
          fromRoleName: roleNameMap.get(p.fromId) ?? p.fromId.slice(0, 8),
          toRoleId: p.toId,
          toRoleName: roleNameMap.get(p.toId) ?? p.toId.slice(0, 8),
          count: p.count,
        }));

      // Human intervention count
      const humanInterventionCount = workflows.filter((wf) => wf.respondentType === 'human').length;

      // Depth distribution
      const depthMap = new Map<number, number>();
      for (const wf of workflows) {
        depthMap.set(wf.depth, (depthMap.get(wf.depth) ?? 0) + 1);
      }
      const depthDistribution = [...depthMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, count]) => ({ depth, count }));

      const analytics: ConversationAnalyticsRecord = {
        mostAskedRoles,
        slowestResponders,
        escalationHotspots,
        humanInterventionCount,
        depthDistribution,
        timeRange: range,
      };
      return ok(analytics);
    } catch (err) {
      logger.error('Failed to get conversation analytics', { error: String(err) });
      return fail('INTERNAL', 'Failed to get conversation analytics');
    }
  });

  // Reply to a conversation as a human
  ipcMain.handle(IPC_CHANNELS.replyToConversation, async (_event, input: unknown) => {
    try {
      const parsed = replyToConversationSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { workflowId, content } = parsed.data;

      const workflow = await workflowRepo.findById(workflowId);
      if (!workflow) {
        return fail('NOT_FOUND', `Conversation workflow ${workflowId} not found`);
      }
      if (workflow.state !== 'waiting_for_reply') {
        return fail('INVALID_STATE', `Conversation is not waiting for reply (state: '${workflow.state}')`);
      }
      if (workflow.respondentType !== 'human') {
        return fail('INVALID_STATE', 'This conversation is not routed to a human respondent');
      }

      // Post the reply as a discussion message
      const msg = await discussionRepo.postMessage({
        groupId: workflow.discussionGroupId,
        authorRoleId: null,
        authorType: 'human',
        content,
        voteTag: null,
        intent: 'reply',
        inReplyToMessageId: workflow.questionMessageId,
      });

      // Handle reply via service (creates PendingWake + state transition + emits events).
      // Must happen BEFORE emitting 'discussion:message-added' to avoid a race where
      // DiscussionService.onMessageAdded also calls handleReply on the same workflow.
      if (conversationService) {
        await conversationService.handleReply(workflowId, msg.id);
      } else {
        // Fallback: manual state transition
        await workflowRepo.updateReply(workflowId, msg.id);
        await workflowRepo.updateState(workflowId, 'reply_received');

        // Log audit event (service path logs internally)
        eventLogger.log(workflowId, 'reply_posted', {
          messageId: msg.id,
          replierType: 'human',
        });

        // Emit conversation event for UI refresh (service path emits internally)
        eventBus.emit({
          type: 'conversation:reply-posted',
          timestamp: new Date().toISOString(),
          payload: {
            workflowId: workflow.id,
            orgId: workflow.orgId,
            askingRoleId: workflow.askingRoleId,
            messageId: msg.id,
            replierRoleId: null,
            replierType: 'human',
            workflow: { ...workflow, state: 'reply_received', replyMessageId: msg.id },
          },
        });
      }

      // Emit message event so discussion UI updates.
      // This fires AFTER handleReply so DiscussionService.onMessageAdded will see
      // the workflow already in 'reply_received' and skip the duplicate transition.
      eventBus.emit({
        type: 'discussion:message-added',
        timestamp: new Date().toISOString(),
        payload: { groupId: workflow.discussionGroupId, messageId: msg.id },
      });

      logger.info('Human reply posted to conversation', { workflowId, messageId: msg.id });
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to reply to conversation', { error: String(err) });
      return fail('INTERNAL', 'Failed to reply to conversation');
    }
  });
}
