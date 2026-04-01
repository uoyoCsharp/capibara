import { ipcMain } from 'electron';
import { IPC_CHANNELS, applyApprovalPresetSchema } from '@shared/contracts.js';
import type { DesktopResult, PendingApprovalRecord } from '@shared/contracts.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { OrgOrchestrator } from '@main/application/orchestrator/org.orchestrator.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerApprovalHandlers(
  roleRepo: IRoleRepository,
  taskRepo: ITaskRepository,
  discussionRepo: IDiscussionRepository,
  orchestrator: OrgOrchestrator,
  logger: ILogger,
): void {
  // Apply approval preset to all roles in an org
  ipcMain.handle(IPC_CHANNELS.applyApprovalPreset, async (_event, input: unknown) => {
    try {
      const parsed = applyApprovalPresetSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }

      const { orgId, preset } = parsed.data;
      const roles = await roleRepo.findByOrgId(orgId);

      for (const role of roles) {
        let value: boolean;
        switch (preset) {
          case 'all_auto':
            value = false;
            break;
          case 'top_level_human':
            value = role.parentId === null;
            break;
          case 'custom':
            // Custom mode: no changes, user manages individually
            continue;
        }
        await roleRepo.update({ id: role.id, requiresHumanApproval: value });
      }

      logger.info('Approval preset applied', { orgId, preset, rolesUpdated: roles.length });
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to apply approval preset', { error: String(err) });
      return fail('INTERNAL', 'Failed to apply approval preset');
    }
  });

  // Get pending approvals for an org
  ipcMain.handle(IPC_CHANNELS.getPendingApprovals, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }

      const tasks = await taskRepo.findByOrgId(orgId);
      const awaitingTasks = tasks.filter((t) => t.status === 'awaiting_review');

      const results: PendingApprovalRecord[] = [];
      for (const task of awaitingTasks) {
        if (!task.assigneeRoleId) continue;
        const role = await roleRepo.findById(task.assigneeRoleId);
        if (!role?.requiresHumanApproval) continue;

        const group = await discussionRepo.findGroupByTaskNodeId(task.id);
        if (!group) continue;

        results.push({
          taskId: task.id,
          taskTitle: task.title,
          orgId: task.orgId,
          roleId: role.id,
          roleName: role.name,
          groupId: group.id,
          status: task.status,
        });
      }

      return ok(results);
    } catch (err) {
      logger.error('Failed to get pending approvals', { error: String(err) });
      return fail('INTERNAL', 'Failed to get pending approvals');
    }
  });

  // Resume all paused roles in an org (Story 10.3)
  ipcMain.handle(IPC_CHANNELS.resumeOrgRoles, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }

      const resumedCount = await orchestrator.resumeOrgRoles(orgId);
      logger.info('Resumed org roles via IPC', { orgId, resumedCount });
      return ok({ resumedCount });
    } catch (err) {
      logger.error('Failed to resume org roles', { error: String(err) });
      return fail('INTERNAL', 'Failed to resume org roles');
    }
  });
}
