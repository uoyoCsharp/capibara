import { ipcMain } from 'electron';
import type { PlanningService } from '@core/modules/planning/planning.service';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerPlanningHandlers(
  planningService: PlanningService,
): void {
  ipcMain.handle('capibara:planning:start', async (_ev, orgId: string, roleId: string, message: string) => {
    try { return ok(planningService.start(orgId, roleId, message)); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:planning:send-message', async (_ev, conversationId: string, message: string) => {
    try { planningService.sendMessage(conversationId, message); return ok(null); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:planning:get-pending', async (_ev, conversationId: string) => {
    try { return ok(planningService.getPendingPlan(conversationId) ?? null); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:planning:confirm', async (_ev, conversationId: string, orgId: string, parentTaskId: string | null) => {
    try { planningService.confirmPlan(conversationId, orgId, parentTaskId); return ok(null); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:planning:discard', async (_ev, conversationId: string) => {
    try { planningService.discardPlan(conversationId); return ok(null); }
    catch (e) { return err('INTERNAL', String(e)); }
  });
}
