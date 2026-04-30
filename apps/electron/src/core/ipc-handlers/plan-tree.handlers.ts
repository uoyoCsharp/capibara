import { ipcMain } from 'electron';
import type { PlanningService } from '@core/modules/planning/planning.service';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerPlanTreeHandlers(planningService: PlanningService): void {
  ipcMain.handle('capibara:plan-tree:get', async (_ev, rootTaskId: string) => {
    try {
      const pending = planningService.getPendingTree(rootTaskId);
      if (!pending) return ok(null);
      return ok({
        rootTaskId: pending.rootTaskId,
        orgId: pending.orgId,
        roleId: pending.roleId,
        mode: pending.mode,
        tree: pending.tree,
        submittedAt: pending.submittedAt,
        version: pending.version,
      });
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:plan-tree:approve', async (_ev, rootTaskId: string, expectedVersion?: number) => {
    try {
      const result = planningService.approvePlanTree(rootTaskId, expectedVersion);
      if (result.ok) return ok(null);
      return err(result.code ?? 'APPROVE_FAILED', result.message ?? 'Approve failed');
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:plan-tree:discard', async (_ev, rootTaskId: string, reason?: string) => {
    try {
      const result = planningService.discardPlanTree(rootTaskId, reason ?? null);
      if (result.ok) return ok(null);
      return err(result.code ?? 'DISCARD_FAILED', result.message ?? 'Discard failed');
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:plan-tree:refine', async (_ev, rootTaskId: string, feedback: string) => {
    try {
      const result = planningService.refinePlanTree(rootTaskId, feedback);
      if (result.ok) return ok(null);
      return err(result.code ?? 'REFINE_FAILED', result.message ?? 'Refine failed');
    } catch (e) { return err('INTERNAL', String(e)); }
  });
}
