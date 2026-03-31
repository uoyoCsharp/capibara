import { ipcMain } from 'electron';
import { IPC_CHANNELS, createRoleSchema, updateRoleSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Role } from '@main/core/types/domain.types.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerRoleHandlers(
  roleRepo: IRoleRepository,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getRolesByOrgId, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const roles = await roleRepo.findByOrgId(orgId);
      return ok(roles);
    } catch (err) {
      logger.error('Failed to get roles', { error: String(err) });
      return fail('INTERNAL', 'Failed to get roles');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getRole, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      const role = await roleRepo.findById(id);
      return ok(role);
    } catch (err) {
      logger.error('Failed to get role', { error: String(err) });
      return fail('INTERNAL', 'Failed to get role');
    }
  });

  ipcMain.handle(IPC_CHANNELS.createRole, async (_event, input: unknown) => {
    try {
      const parsed = createRoleSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const role = await roleRepo.create(parsed.data);
      return ok(role);
    } catch (err) {
      logger.error('Failed to create role', { error: String(err) });
      return fail('INTERNAL', 'Failed to create role');
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateRole, async (_event, input: unknown) => {
    try {
      const parsed = updateRoleSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const role = await roleRepo.update(parsed.data);
      return ok(role);
    } catch (err) {
      logger.error('Failed to update role', { error: String(err) });
      return fail('INTERNAL', 'Failed to update role');
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteRole, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      await roleRepo.delete(id);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to delete role', { error: String(err) });
      return fail('INTERNAL', 'Failed to delete role');
    }
  });
}
