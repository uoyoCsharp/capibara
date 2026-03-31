import { ipcMain } from 'electron';
import { IPC_CHANNELS, createOrganizationSchema, updateOrganizationSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Organization } from '@main/core/types/domain.types.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerOrganizationHandlers(
  orgRepo: IOrganizationRepository,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getOrganizations, async () => {
    try {
      const orgs = await orgRepo.findAll();
      return ok(orgs);
    } catch (err) {
      logger.error('Failed to get organizations', { error: String(err) });
      return fail('INTERNAL', 'Failed to get organizations');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getOrganization, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      const org = await orgRepo.findById(id);
      return ok(org);
    } catch (err) {
      logger.error('Failed to get organization', { error: String(err) });
      return fail('INTERNAL', 'Failed to get organization');
    }
  });

  ipcMain.handle(IPC_CHANNELS.createOrganization, async (_event, input: unknown) => {
    try {
      const parsed = createOrganizationSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const org = await orgRepo.create(parsed.data);
      return ok(org);
    } catch (err) {
      logger.error('Failed to create organization', { error: String(err) });
      return fail('INTERNAL', 'Failed to create organization');
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateOrganization, async (_event, input: unknown) => {
    try {
      const parsed = updateOrganizationSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const org = await orgRepo.update(parsed.data);
      return ok(org);
    } catch (err) {
      logger.error('Failed to update organization', { error: String(err) });
      return fail('INTERNAL', 'Failed to update organization');
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteOrganization, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      await orgRepo.delete(id);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to delete organization', { error: String(err) });
      return fail('INTERNAL', 'Failed to delete organization');
    }
  });
}
