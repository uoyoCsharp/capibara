import { existsSync, statSync, accessSync, constants } from 'node:fs';
import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { IPC_CHANNELS, createOrganizationSchema, updateOrganizationSchema, deleteOrganizationSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Organization } from '@main/core/types/domain.types.js';
import { DEFAULT_WORKFLOW_SCHEMA } from '@main/application/workflow/default-workflow-schema.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

function validateWorkspacePath(path: string): string | null {
  if (!existsSync(path)) return 'Path does not exist';
  if (!statSync(path).isDirectory()) return 'Path is not a directory';
  try {
    accessSync(path, constants.W_OK);
  } catch {
    return 'Path is not writable';
  }
  return null;
}

export function registerOrganizationHandlers(
  orgRepo: IOrganizationRepository,
  logger: ILogger,
  workflowEngine?: IWorkflowEngine,
): void {
  ipcMain.handle(IPC_CHANNELS.selectFolder, async () => {
    try {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!win) {
        return fail<string | null>('NO_WINDOW', 'No application window available');
      }
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Workspace Folder',
      });
      if (result.canceled || result.filePaths.length === 0) {
        return ok<string | null>(null);
      }
      return ok<string | null>(result.filePaths[0]);
    } catch (err) {
      logger.error('Failed to open folder dialog', { error: String(err) });
      return fail('INTERNAL', 'Failed to open folder dialog');
    }
  });

  ipcMain.handle(IPC_CHANNELS.openFolder, async (_event, folderPath: unknown) => {
    try {
      if (typeof folderPath !== 'string' || !folderPath) {
        return fail<void>('VALIDATION', 'Invalid folder path');
      }
      if (!existsSync(folderPath)) {
        return fail<void>('NOT_FOUND', 'Folder does not exist');
      }
      const errorMessage = await shell.openPath(folderPath);
      if (errorMessage) {
        return fail<void>('OPEN_FAILED', errorMessage);
      }
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to open folder', { error: String(err) });
      return fail('INTERNAL', 'Failed to open folder');
    }
  });

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
      const pathError = validateWorkspacePath(parsed.data.workspacePath);
      if (pathError) {
        return fail('INVALID_WORKSPACE_PATH', pathError);
      }
      const org = await orgRepo.create(parsed.data);

      // Initialize default workflow schema for new organization
      if (workflowEngine) {
        try {
          await workflowEngine.saveSchema(org.id, DEFAULT_WORKFLOW_SCHEMA);
          logger.info('Default workflow schema created for org', { orgId: org.id });
        } catch (schemaErr) {
          logger.error('Failed to create default schema for org', { orgId: org.id, error: String(schemaErr) });
        }
      }

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
      if (parsed.data.workspacePath) {
        const pathError = validateWorkspacePath(parsed.data.workspacePath);
        if (pathError) {
          return fail('INVALID_WORKSPACE_PATH', pathError);
        }
      }
      const org = await orgRepo.update(parsed.data);
      return ok(org);
    } catch (err) {
      logger.error('Failed to update organization', { error: String(err) });
      return fail('INTERNAL', 'Failed to update organization');
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteOrganization, async (_event, input: unknown) => {
    try {
      const parsed = deleteOrganizationSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const org = await orgRepo.findById(parsed.data.orgId);
      if (!org) {
        return fail('NOT_FOUND', 'Organization not found');
      }
      if (org.name !== parsed.data.confirmName) {
        return fail('NAME_MISMATCH', 'Confirmation name does not match the organization name');
      }
      await orgRepo.delete(parsed.data.orgId);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to delete organization', { error: String(err) });
      return fail('INTERNAL', 'Failed to delete organization');
    }
  });
}
