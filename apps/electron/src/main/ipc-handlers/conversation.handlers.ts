import { ipcMain } from 'electron';
import { IPC_CHANNELS, cancelConversationSchema } from '@shared/contracts.js';
import type { DesktopResult, ConversationWorkflowRecord, ConversationMetricsRecord, ConversationAnalyticsRecord, ConversationTimeRange } from '@shared/contracts.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
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
): void {
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
}
