import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts.js';
import type { DesktopResult, AppSnapshot } from '@shared/contracts.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

export function registerSnapshotHandlers(
  orgRepo: IOrganizationRepository,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.loadSnapshot, async (): Promise<DesktopResult<AppSnapshot>> => {
    try {
      const organizations = await orgRepo.findAll();
      return {
        ok: true,
        data: {
          organizations: organizations.map((o) => ({
            id: o.id,
            name: o.name,
            description: o.description,
            status: o.status,
            budgetLimit: o.budgetLimit,
            orgTemplateId: o.orgTemplateId,
            workspacePath: o.workspacePath,
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
          })),
          currentOrgId: organizations[0]?.id ?? null,
        },
      };
    } catch (err) {
      logger.error('Failed to load snapshot', { error: String(err) });
      return { ok: false, error: { code: 'INTERNAL', message: 'Failed to load snapshot' } };
    }
  });
}
