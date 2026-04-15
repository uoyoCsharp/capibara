import { ipcMain, shell } from 'electron';
import {
  IPC_CHANNELS,
  startSessionSchema,
  sendSessionMessageSchema,
  cancelSessionSchema,
  switchSessionRoleSchema,
} from '@shared/contracts.js';
import type { DesktopResult, SessionType } from '@shared/contracts.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { SessionService } from '../application/session/session.service.js';
import type { SessionRunCoordinator } from '../application/session/session-run.coordinator.js';
import type { FileLogService } from '../infrastructure/logging/file-log.service.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerSessionHandlers(
  sessionService: SessionService,
  sessionRunCoordinator: SessionRunCoordinator,
  orgRepo: IOrganizationRepository,
  fileLogService: FileLogService,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.openSessionLogFolder, async (_event, sessionId: unknown) => {
    try {
      if (typeof sessionId !== 'string' || !sessionId) {
        return fail('VALIDATION_ERROR', 'sessionId must be a non-empty string');
      }
      const session = await sessionService.getSession(sessionId);
      if (!session) return fail('NOT_FOUND', 'Session not found');

      const org = await orgRepo.findById(session.orgId);
      const orgName = org?.name ?? session.orgId;
      const logDir = fileLogService.getLogDir(orgName, session.id);

      await shell.openPath(logDir);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to open session log folder', { error: String(err) });
      return fail('INTERNAL', 'Failed to open session log folder');
    }
  });

  ipcMain.handle(IPC_CHANNELS.startSession, async (_event, input: unknown) => {
    try {
      const parsed = startSessionSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { orgId, type, roleId, initialMessage } = parsed.data;

      // Create session + store initial message
      const session = await sessionService.startSession(orgId, type, roleId, initialMessage);

      // Execute first round (skip user message — already stored by startSession)
      sessionRunCoordinator.executeInSession(session.id, initialMessage, true).catch((err) => {
        logger.error('Background session execution failed', { sessionId: session.id, error: String(err) });
      });

      return ok(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to start session', { error: msg });
      return fail('EXECUTION_ERROR', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.sendSessionMessage, async (_event, input: unknown) => {
    try {
      const parsed = sendSessionMessageSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { sessionId, message } = parsed.data;

      // Execute in background — result delivered via events
      sessionRunCoordinator.executeInSession(sessionId, message).catch((err) => {
        logger.error('Background session execution failed', { sessionId, error: String(err) });
      });

      return ok({ status: 'executing', sessionId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to send session message', { error: msg });
      return fail('EXECUTION_ERROR', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getActiveSession, async (_event, orgId: unknown, type: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      if (type !== 'planning' && type !== 'adhoc') {
        return fail('VALIDATION_ERROR', 'type must be "planning" or "adhoc"');
      }
      const session = await sessionService.getActiveSession(orgId, type as SessionType);
      return ok(session);
    } catch (err) {
      logger.error('Failed to get active session', { error: String(err) });
      return fail('INTERNAL', 'Failed to get active session');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSessionMessages, async (_event, sessionId: unknown) => {
    try {
      if (typeof sessionId !== 'string' || !sessionId) {
        return fail('VALIDATION_ERROR', 'sessionId must be a non-empty string');
      }
      const messages = await sessionService.getSessionMessages(sessionId);
      return ok(messages);
    } catch (err) {
      logger.error('Failed to get session messages', { error: String(err) });
      return fail('INTERNAL', 'Failed to get session messages');
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelSession, async (_event, input: unknown) => {
    try {
      const parsed = cancelSessionSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      await sessionService.cancelSession(parsed.data.sessionId);
      return ok(undefined as void);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to cancel session', { error: msg });
      return fail('INTERNAL', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.switchSessionRole, async (_event, input: unknown) => {
    try {
      const parsed = switchSessionRoleSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      await sessionService.switchRole(parsed.data.sessionId, parsed.data.newRoleId);
      return ok(undefined as void);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to switch session role', { error: msg });
      return fail('INTERNAL', msg);
    }
  });
}
