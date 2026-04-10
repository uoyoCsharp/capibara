import { existsSync, statSync, accessSync, constants } from 'node:fs';
import { ipcMain } from 'electron';
import { IPC_CHANNELS, loadTemplateSchema } from '@shared/contracts.js';
import type { DesktopResult, TemplateRecord, WorkflowTemplateRecord } from '@shared/contracts.js';
import type { OrgTemplateService } from '@main/application/templates/org-template.service.js';
import type { WorkflowTemplateService } from '@main/application/workflow/workflow-template.service.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

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

export function registerTemplateHandlers(
  templateService: OrgTemplateService,
  workflowTemplateService: WorkflowTemplateService,
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

  ipcMain.handle(IPC_CHANNELS.getWorkflowTemplates, async () => {
    try {
      const templates = workflowTemplateService.getTemplates();
      const records: WorkflowTemplateRecord[] = templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        schema: t.schema as WorkflowTemplateRecord['schema'],
      }));
      return ok(records);
    } catch (err) {
      logger.error('Failed to get workflow templates', { error: String(err) });
      return fail('INTERNAL', 'Failed to get workflow templates');
    }
  });

  ipcMain.handle(IPC_CHANNELS.loadTemplate, async (_event, input: unknown) => {
    try {
      const parsed = loadTemplateSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const pathError = validateWorkspacePath(parsed.data.workspacePath);
      if (pathError) {
        return fail('INVALID_WORKSPACE_PATH', pathError);
      }

      // Resolve workflow schema from selected template
      const workflowSchema = workflowTemplateService.resolveSchema(parsed.data.workflowTemplateId);

      const org = await templateService.loadTemplate(
        parsed.data.templateId,
        parsed.data.orgName,
        parsed.data.orgDescription,
        parsed.data.budgetLimit,
        parsed.data.workspacePath,
        workflowSchema,
      );
      return ok(org);
    } catch (err) {
      logger.error('Failed to load template', { error: String(err) });
      return fail('INTERNAL', 'Failed to load template');
    }
  });
}
