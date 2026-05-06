import { ipcMain } from 'electron';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ProcessTemplateService } from '@core/modules/workflow/services/process-template.service';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerWorkflowHandlers(
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
  processTemplateService: ProcessTemplateService,
): void {
  ipcMain.handle('capibara:task:list', async (_ev, orgId: string) => {
    try { return ok(taskService.findByOrgId(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:task:get', async (_ev, id: string) => {
    try {
      const task = taskService.findById(id);
      return task ? ok(task) : err('NOT_FOUND', `Task not found: ${id}`);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:task:children', async (_ev, parentId: string) => {
    try { return ok(taskService.findChildren(parentId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:task:create', async (_ev, input: unknown) => {
    try { return ok(taskService.create(input as Parameters<typeof taskService.create>[0])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:task:transition', async (_ev, taskId: string, newStatus: string) => {
    try { return ok(taskStateMachine.transition(taskId, newStatus)); }
    catch (e) { return err('INVALID_TRANSITION', String(e)); }
  });

  ipcMain.handle('capibara:task:cancel', async (_ev, taskId: string) => {
    try {
      const task = taskService.findById(taskId);
      if (!task) return err('NOT_FOUND', `Task not found: ${taskId}`);
      const transitions = processEngine.getAvailableTransitions(task.orgId, task.status);
      const cancelTarget = transitions.find((t) => t.to === 'cancelled');
      if (!cancelTarget) return err('INVALID_TRANSITION', `Cannot cancel task in status: ${task.status}`);
      return ok(taskStateMachine.transition(taskId, 'cancelled'));
    } catch (e) { return err('INVALID_TRANSITION', String(e)); }
  });

  ipcMain.handle('capibara:task:delete', async (_ev, id: string) => {
    try { taskService.delete(id); return ok(null); }
    catch (e) { return err('NOT_FOUND', String(e)); }
  });

  ipcMain.handle('capibara:task:approve', async (_ev, taskId: string, nextStatus: string) => {
    try { return ok(taskStateMachine.confirmApproval(taskId, nextStatus)); }
    catch (e) { return err('INVALID_TRANSITION', String(e)); }
  });

  ipcMain.handle('capibara:task:reject', async (_ev, taskId: string, revertStatus: string) => {
    try { return ok(taskStateMachine.rejectApproval(taskId, revertStatus)); }
    catch (e) { return err('INVALID_TRANSITION', String(e)); }
  });

  ipcMain.handle('capibara:process:get-schema', async (_ev, orgId: string) => {
    try { return ok(processEngine.getSchema(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:process:save-schema', async (_ev, orgId: string, schema: unknown) => {
    try {
      processEngine.saveSchema(orgId, schema as Parameters<typeof processEngine.saveSchema>[1]);
      return ok(null);
    } catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:process:templates', async () => {
    try { return ok(processTemplateService.getTemplates()); }
    catch (e) { return err('INTERNAL', String(e)); }
  });
}
