import { ipcMain } from 'electron';
import { IPC_CHANNELS, createTaskSchema, updateTaskStatusSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { TaskNode } from '@main/core/types/domain.types.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { TaskService } from '../application/tasks/task.service.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerTaskHandlers(
  taskService: TaskService,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getTasksByOrgId, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const tasks = await taskService.findByOrgId(orgId);
      return ok(tasks);
    } catch (err) {
      logger.error('Failed to get tasks', { error: String(err) });
      return fail('INTERNAL', 'Failed to get tasks');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getTask, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      const task = await taskService.findById(id);
      return ok(task);
    } catch (err) {
      logger.error('Failed to get task', { error: String(err) });
      return fail('INTERNAL', 'Failed to get task');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getTaskChildren, async (_event, parentId: unknown) => {
    try {
      if (typeof parentId !== 'string' || !parentId) {
        return fail('VALIDATION_ERROR', 'parentId must be a non-empty string');
      }
      const children = await taskService.findChildren(parentId);
      return ok(children);
    } catch (err) {
      logger.error('Failed to get task children', { error: String(err) });
      return fail('INTERNAL', 'Failed to get task children');
    }
  });

  ipcMain.handle(IPC_CHANNELS.createTask, async (_event, input: unknown) => {
    try {
      const parsed = createTaskSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const task = await taskService.create(parsed.data);
      return ok(task);
    } catch (err) {
      logger.error('Failed to create task', { error: String(err) });
      return fail('INTERNAL', 'Failed to create task');
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateTaskStatus, async (_event, input: unknown) => {
    try {
      const parsed = updateTaskStatusSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      await taskService.updateStatus(parsed.data.id, parsed.data.status);
      return ok(undefined as void);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to update task status', { error: msg });
      return fail('INTERNAL', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteTask, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      await taskService.delete(id);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to delete task', { error: String(err) });
      return fail('INTERNAL', 'Failed to delete task');
    }
  });
}
