import { ipcMain } from 'electron';
import type { OrganizationService } from '@core/modules/organization/services/organization.service';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { SkillService } from '@core/modules/organization/services/skill.service';
import type { OrgTemplateService } from '@core/modules/organization/services/org-template.service';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerOrganizationHandlers(
  orgService: OrganizationService,
  roleService: RoleService,
  skillService: SkillService,
  orgTemplateService: OrgTemplateService,
  logger: ILogger,
): void {
  ipcMain.handle('capibara:org:list', async () => {
    try { return ok(orgService.findAll()); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:org:get', async (_ev, id: string) => {
    try {
      const org = orgService.findById(id);
      return org ? ok(org) : err('NOT_FOUND', `Organization not found: ${id}`);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:org:create', async (_ev, input: unknown) => {
    try { return ok(orgService.create(input as Parameters<typeof orgService.create>[0])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:org:update', async (_ev, input: unknown) => {
    try { return ok(orgService.update(input as Parameters<typeof orgService.update>[0])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:org:delete', async (_ev, id: string) => {
    try { orgService.delete(id); return ok(null); }
    catch (e) { return err('NOT_FOUND', String(e)); }
  });

  ipcMain.handle('capibara:role:list', async (_ev, orgId: string) => {
    try { return ok(roleService.findByOrgId(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:role:get', async (_ev, id: string) => {
    try {
      const role = roleService.findById(id);
      return role ? ok(role) : err('NOT_FOUND', `Role not found: ${id}`);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:role:create', async (_ev, input: unknown) => {
    try { return ok(roleService.create(input as Parameters<typeof roleService.create>[0])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:role:update', async (_ev, input: unknown) => {
    try { return ok(roleService.update(input as Parameters<typeof roleService.update>[0])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:role:delete', async (_ev, id: string) => {
    try { roleService.delete(id); return ok(null); }
    catch (e) { return err('NOT_FOUND', String(e)); }
  });

  ipcMain.handle('capibara:skill:list', async () => {
    try { return ok(skillService.findAll()); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:skill:get', async (_ev, id: string) => {
    try {
      const skill = skillService.findById(id);
      return skill ? ok(skill) : err('NOT_FOUND', `Skill not found: ${id}`);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:skill:create', async (_ev, input: unknown) => {
    try { return ok(skillService.create(input as Parameters<typeof skillService.create>[0])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:skill:delete', async (_ev, id: string) => {
    try { skillService.delete(id); return ok(null); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:template:list', async () => {
    try { return ok(orgTemplateService.getTemplates()); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:template:load', async (
    _ev,
    templateId: string,
    orgName: string,
    workspacePath: string,
    processTemplateId?: string | null,
    locale?: string,
  ) => {
    try {
      return ok(orgTemplateService.loadTemplate(
        templateId,
        orgName,
        workspacePath,
        processTemplateId ?? null,
        (locale === 'zh-CN' ? 'zh-CN' : 'en-US'),
      ));
    } catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });
}
