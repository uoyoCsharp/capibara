import { ipcMain } from 'electron';
import { IPC_CHANNELS, postDiscussionMessageSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DiscussionService } from '../application/discussion/discussion.service.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerDiscussionHandlers(
  discussionService: DiscussionService,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getDiscussionGroupsByOrgId, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const groups = await discussionService.findGroupsByOrgId(orgId);
      return ok(groups);
    } catch (err) {
      logger.error('Failed to get discussion groups', { error: String(err) });
      return fail('INTERNAL', 'Failed to get discussion groups');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDiscussionGroupByTaskNodeId, async (_event, taskNodeId: unknown) => {
    try {
      if (typeof taskNodeId !== 'string' || !taskNodeId) {
        return fail('VALIDATION_ERROR', 'taskNodeId must be a non-empty string');
      }
      const group = await discussionService.findGroupByTaskNodeId(taskNodeId);
      return ok(group);
    } catch (err) {
      logger.error('Failed to get discussion group by task', { error: String(err) });
      return fail('INTERNAL', 'Failed to get discussion group');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDiscussionMessages, async (_event, groupId: unknown) => {
    try {
      if (typeof groupId !== 'string' || !groupId) {
        return fail('VALIDATION_ERROR', 'groupId must be a non-empty string');
      }
      const messages = await discussionService.findMessagesByGroupId(groupId);
      return ok(messages);
    } catch (err) {
      logger.error('Failed to get discussion messages', { error: String(err) });
      return fail('INTERNAL', 'Failed to get discussion messages');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDiscussionVoteStats, async (_event, groupId: unknown) => {
    try {
      if (typeof groupId !== 'string' || !groupId) {
        return fail('VALIDATION_ERROR', 'groupId must be a non-empty string');
      }
      const stats = await discussionService.getVoteStats(groupId);
      return ok(stats);
    } catch (err) {
      logger.error('Failed to get vote stats', { error: String(err) });
      return fail('INTERNAL', 'Failed to get vote stats');
    }
  });

  ipcMain.handle(IPC_CHANNELS.postDiscussionMessage, async (_event, input: unknown) => {
    try {
      const parsed = postDiscussionMessageSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const message = await discussionService.postMessage(parsed.data);
      return ok(message);
    } catch (err) {
      logger.error('Failed to post discussion message', { error: String(err) });
      return fail('INTERNAL', 'Failed to post discussion message');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDiscussionSummary, async (_event, groupId: unknown) => {
    try {
      if (typeof groupId !== 'string' || !groupId) {
        return fail('VALIDATION_ERROR', 'groupId must be a non-empty string');
      }
      const group = await discussionService.findGroupById(groupId);
      return ok(group?.summary ?? null);
    } catch (err) {
      logger.error('Failed to get discussion summary', { error: String(err) });
      return fail('INTERNAL', 'Failed to get discussion summary');
    }
  });
}
