import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  startPlanningRunSchema,
  discardPlanningSessionSchema,
  batchCreateTasksSchema,
  switchPlanningRoleSchema,
} from '@shared/contracts.js';
import type { DesktopResult, PlanTaskNode } from '@shared/contracts.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { PlanningService } from '../application/planning/planning.service.js';
import type { TaskService } from '../application/tasks/task.service.js';
import type { PendingPlanStore } from '../application/planning/pending-plan.store.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerPlanningHandlers(
  planningService: PlanningService,
  taskService: TaskService,
  roleRepo: IRoleRepository,
  workflowEngine: IWorkflowEngine,
  pendingPlanStore: PendingPlanStore,
  logger: ILogger,
): void {
  // DEPRECATED: Use capibara:session:start instead. Retained for backward compatibility.
  ipcMain.handle(IPC_CHANNELS.startPlanningRun, async (_event, input: unknown) => {
    logger.warn('[DEPRECATED] capibara:planning:start called — use capibara:session:start instead');
    try {
      const parsed = startPlanningRunSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const result = await planningService.startPlanningRun(
        parsed.data.orgId,
        parsed.data.initialMessage,
        parsed.data.roleId,
      );
      return ok(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to start planning run', { error: msg });
      return fail('EXECUTION_ERROR', msg);
    }
  });

  // DEPRECATED: Use capibara:session:get-active instead. Retained for backward compatibility.
  ipcMain.handle(IPC_CHANNELS.getActivePlanningSession, async (_event, orgId: unknown) => {
    logger.warn('[DEPRECATED] capibara:planning:get-active called — use capibara:session:get-active instead');
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const session = await planningService.getActivePlanningSession(orgId);
      return ok(session);
    } catch (err) {
      logger.error('Failed to get active planning session', { error: String(err) });
      return fail('INTERNAL', 'Failed to get active planning session');
    }
  });

  // DEPRECATED: Use capibara:session:cancel instead. Retained for backward compatibility.
  ipcMain.handle(IPC_CHANNELS.discardPlanningSession, async (_event, input: unknown) => {
    logger.warn('[DEPRECATED] capibara:planning:discard called — use capibara:session:cancel instead');
    try {
      const parsed = discardPlanningSessionSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      await planningService.discardPlanningSession(parsed.data.id);
      return ok(undefined as void);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to discard planning session', { error: msg });
      return fail('INTERNAL', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getPendingPlan, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const plan = pendingPlanStore.get(orgId);
      return ok(plan);
    } catch (err) {
      logger.error('Failed to get pending plan', { error: String(err) });
      return fail('INTERNAL', 'Failed to get pending plan');
    }
  });

  ipcMain.handle(IPC_CHANNELS.clearPendingPlan, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      pendingPlanStore.remove(orgId);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to clear pending plan', { error: String(err) });
      return fail('INTERNAL', 'Failed to clear pending plan');
    }
  });

  ipcMain.handle(IPC_CHANNELS.batchCreateTasks, async (_event, input: unknown) => {
    try {
      const parsed = batchCreateTasksSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }

      const { orgId, plan } = parsed.data;

      // Validate total task count (same limit as MCP tool)
      const MAX_BATCH_TASKS = 50;
      const countNodes = (nodes: PlanTaskNode[]): number =>
        nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
      const totalTasks = countNodes(plan.tasks);
      if (totalTasks > MAX_BATCH_TASKS) {
        return fail('VALIDATION_ERROR', `Plan exceeds maximum of ${MAX_BATCH_TASKS} tasks (got ${totalTasks})`);
      }

      const createdIds: string[] = [];

      // Build role name → ID map
      const roles = await roleRepo.findByOrgId(orgId);
      const roleNameMap = new Map<string, string>();
      for (const role of roles) {
        roleNameMap.set(role.name.toLowerCase(), role.id);
      }

      // Create tasks in depth-first order
      const createTree = async (
        nodes: PlanTaskNode[],
        parentId: string | null,
      ): Promise<void> => {
        for (const node of nodes) {
          let assigneeRoleId: string | null = null;
          if (node.assigneeRoleName) {
            assigneeRoleId = roleNameMap.get(node.assigneeRoleName.toLowerCase()) ?? null;
            if (!assigneeRoleId) {
              logger.warn('Role name not found during batch create, task will be unassigned', {
                roleName: node.assigneeRoleName, taskTitle: node.title,
              });
            }
          }

          const task = await taskService.create({
            orgId,
            parentId,
            type: node.type,
            title: node.title,
            description: node.description,
            assigneeRoleId,
          });
          createdIds.push(task.id);

          if (node.children.length > 0) {
            await createTree(node.children, task.id);
          }
        }
      };

      try {
        await createTree(plan.tasks, null);
      } catch (err) {
        // Rollback: delete in reverse order (children first)
        const rollbackErrors: string[] = [];
        for (const id of createdIds.reverse()) {
          try {
            await taskService.delete(id);
          } catch (delErr) {
            rollbackErrors.push(`${id}: ${String(delErr)}`);
          }
        }
        if (rollbackErrors.length > 0) {
          logger.warn('Partial rollback failure during batch create', { rollbackErrors });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return fail('BATCH_CREATE_ERROR', msg);
      }

      // Clear pending plan after successful creation
      pendingPlanStore.remove(orgId);

      // Also discard the planning session if found
      const session = await planningService.getActivePlanningSession(orgId);
      if (session) {
        const discardId = session.sessionId ?? session.taskId;
        if (discardId) {
          await planningService.discardPlanningSession(discardId);
        }
      }

      return ok({ createdCount: createdIds.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to batch create tasks', { error: msg });
      return fail('INTERNAL', msg);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getAvailablePlanningRoles, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const roles = await planningService.getAvailablePlanningRoles(orgId);
      return ok(roles);
    } catch (err) {
      logger.error('Failed to get available planning roles', { error: String(err) });
      return fail('INTERNAL', 'Failed to get available planning roles');
    }
  });

  // DEPRECATED: Use capibara:session:switch-role instead. Retained for backward compatibility.
  ipcMain.handle(IPC_CHANNELS.switchPlanningRole, async (_event, input: unknown) => {
    logger.warn('[DEPRECATED] capibara:planning:switch-role called — use capibara:session:switch-role instead');
    try {
      const parsed = switchPlanningRoleSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const result = await planningService.switchPlanningRole(parsed.data.sessionId, parsed.data.newRoleId);
      return ok(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to switch planning role', { error: msg });
      return fail('INTERNAL', msg);
    }
  });
}
