import { ipcMain } from 'electron';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IRunEngine } from '@core/modules/execution/interfaces/i-run-engine';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';
import type { FileLogService } from '@core/modules/execution/logging/file-log.service';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerExecutionHandlers(
  runRepo: IRunRepository,
  runEngine: IRunEngine,
  costTracker: CostTracker,
  fileLogService?: FileLogService,
): void {
  ipcMain.handle('capibara:run:list', async (_ev, orgId: string) => {
    try { return ok(runRepo.findByOrgId(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:run:get', async (_ev, id: string) => {
    try {
      const run = runRepo.findById(id);
      return run ? ok(run) : err('NOT_FOUND', `Run not found: ${id}`);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:run:by-task', async (_ev, taskId: string) => {
    try { return ok(runRepo.findByTaskId(taskId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:run:cancel', async (_ev, runId: string) => {
    try { await runEngine.cancelRun(runId); return ok(null); }
    catch (e) { return err('EXECUTION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:cost:summary', async (_ev, orgId: string) => {
    try { return ok(costTracker.getBudgetUsage(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:run:logs', async (_ev, runId: string) => {
    try {
      const run = runRepo.findById(runId);
      if (!run) return err('NOT_FOUND', `Run not found: ${runId}`);
      if (!fileLogService) return ok([]);
      const lines = await fileLogService.readRaw(run.orgId, run.taskId ?? run.conversationId ?? run.id, runId);
      return ok(lines);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:run:log-dir', async (_ev, runId: string) => {
    try {
      const run = runRepo.findById(runId);
      if (!run) return err('NOT_FOUND', `Run not found: ${runId}`);
      if (!fileLogService) return ok(null);
      const dir = fileLogService.resolveLogDir(run.orgId, run.taskId ?? run.conversationId ?? run.id);
      return ok(dir);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:logs:stats', async () => {
    try {
      if (!fileLogService) return ok({ totalSizeMB: 0, fileCount: 0, oldestMonth: null, newestMonth: null });
      return ok(fileLogService.getLogStats());
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:logs:clear-all', async () => {
    try {
      if (!fileLogService) return ok({ deletedFiles: 0, freedMB: 0 });
      return ok(fileLogService.clearAllLogs());
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:logs:clear-before', async (_ev, cutoffMonth: string) => {
    try {
      if (!fileLogService) return ok({ deletedFiles: 0, freedMB: 0 });
      return ok(fileLogService.clearBeforeMonth(cutoffMonth));
    } catch (e) { return err('INTERNAL', String(e)); }
  });
}
