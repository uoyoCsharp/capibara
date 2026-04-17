import { ipcMain } from 'electron';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IRunEngine } from '@core/modules/execution/interfaces/i-run-engine';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerExecutionHandlers(
  runRepo: IRunRepository,
  runEngine: IRunEngine,
  costTracker: CostTracker,
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
}
