import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts.js';
import type { DesktopResult, SystemCheckResult } from '@shared/contracts.js';
import type { SystemCheckService } from '@main/application/system/system-check.service.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerSystemHandlers(
  systemCheckService: SystemCheckService,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.checkSystemDeps, async () => {
    try {
      const result: SystemCheckResult = await systemCheckService.check();
      return ok(result);
    } catch (err) {
      logger.error('System dependency check failed', { error: String(err) });
      return fail('INTERNAL', 'System dependency check failed');
    }
  });
}
