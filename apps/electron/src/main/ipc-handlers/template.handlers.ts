import { ipcMain } from 'electron';
import { IPC_CHANNELS, loadTemplateSchema } from '@shared/contracts.js';
import type { DesktopResult, TemplateRecord } from '@shared/contracts.js';
import type { OrgTemplateService } from '@main/application/templates/org-template.service.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerTemplateHandlers(
  templateService: OrgTemplateService,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getTemplates, async () => {
    try {
      const templates = templateService.getTemplates();
      const records: TemplateRecord[] = templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        rootRoles: t.rootRoles,
      }));
      return ok(records);
    } catch (err) {
      logger.error('Failed to get templates', { error: String(err) });
      return fail('INTERNAL', 'Failed to get templates');
    }
  });

  ipcMain.handle(IPC_CHANNELS.loadTemplate, async (_event, input: unknown) => {
    try {
      const parsed = loadTemplateSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const org = await templateService.loadTemplate(
        parsed.data.templateId,
        parsed.data.orgName,
        parsed.data.orgDescription,
        parsed.data.budgetLimit,
      );
      return ok(org);
    } catch (err) {
      logger.error('Failed to load template', { error: String(err) });
      return fail('INTERNAL', 'Failed to load template');
    }
  });
}
