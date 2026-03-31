import { ipcMain } from 'electron';
import { IPC_CHANNELS, startRunSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { ExecutionEngine } from '../application/execution/execution.engine.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerRunHandlers(
  runRepo: IRunRepository,
  executionEngine: ExecutionEngine,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getRunsByOrgId, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const runs = await runRepo.findByOrgId(orgId);
      return ok(runs);
    } catch (err) {
      logger.error('Failed to get runs', { error: String(err) });
      return fail('INTERNAL', 'Failed to get runs');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getRun, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      const run = await runRepo.findById(id);
      return ok(run);
    } catch (err) {
      logger.error('Failed to get run', { error: String(err) });
      return fail('INTERNAL', 'Failed to get run');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getRunsByTaskId, async (_event, taskNodeId: unknown) => {
    try {
      if (typeof taskNodeId !== 'string' || !taskNodeId) {
        return fail('VALIDATION_ERROR', 'taskNodeId must be a non-empty string');
      }
      const runs = await runRepo.findByTaskId(taskNodeId);
      return ok(runs);
    } catch (err) {
      logger.error('Failed to get runs by task', { error: String(err) });
      return fail('INTERNAL', 'Failed to get runs by task');
    }
  });

  ipcMain.handle(IPC_CHANNELS.startRun, async (_event, input: unknown) => {
    try {
      const parsed = startRunSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const run = await executionEngine.startRun(
        parsed.data.roleId,
        parsed.data.taskNodeId,
        parsed.data.orgId,
        parsed.data.trigger,
      );
      return ok(run);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to start run', { error: msg });
      return fail('EXECUTION_ERROR', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelRun, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      await executionEngine.cancelRun(id);
      return ok(undefined as void);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to cancel run', { error: msg });
      return fail('INTERNAL', msg);
    }
  });
}
