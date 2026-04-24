import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { RoleRecord, SkillRecord } from '@core/shared/types';

function role(id: string): RoleRecord {
  return {
    id,
    orgId: 'org-1',
    name: id,
    parentId: null,
    persona: '',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    consecutiveWakeCount: 0,
    isSystemRole: false,
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };
}

function skill(id: string): SkillRecord {
  return {
    id,
    name: id,
    command: id,
    description: '',
    category: 'general',
    source: 'custom',
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: '',
  };
}

describe('useOrganizationStore', () => {
  let ctrl: MockCapibaraApiController;
  let useOrganizationStore: typeof import('@renderer/store/organization.store').useOrganizationStore;

  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    useOrganizationStore = (await import('@renderer/store/organization.store')).useOrganizationStore;
  });

  it('loadRoles populates state', async () => {
    vi.mocked(ctrl.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [role('r1')] });
    await useOrganizationStore.getState().loadRoles('org-1');
    expect(useOrganizationStore.getState().roles).toHaveLength(1);
    expect(useOrganizationStore.getState().isLoadingRoles).toBe(false);
  });

  it('deleteRole reloads on success', async () => {
    vi.mocked(ctrl.api.deleteRole).mockResolvedValue({ ok: true, data: null });
    vi.mocked(ctrl.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [] });
    await useOrganizationStore.getState().deleteRole('r1', 'org-1');
    expect(ctrl.api.getRolesByOrgId).toHaveBeenCalledWith('org-1');
  });

  it('deleteSkill reloads skills on success', async () => {
    vi.mocked(ctrl.api.deleteSkill).mockResolvedValue({ ok: true, data: null });
    vi.mocked(ctrl.api.getSkills).mockResolvedValue({ ok: true, data: [] });
    const ok = await useOrganizationStore.getState().deleteSkill('s1');
    expect(ok).toBe(true);
    expect(ctrl.api.getSkills).toHaveBeenCalled();
  });

  it('role:changed event for current org reloads roles', async () => {
    useOrganizationStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [] });
    useOrganizationStore.getState().init();

    ctrl.emit({ type: 'role:changed', orgId: 'org-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getRolesByOrgId).toHaveBeenCalled();
  });

  it('role:changed for different org does nothing', async () => {
    useOrganizationStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [] });
    useOrganizationStore.getState().init();
    vi.mocked(ctrl.api.getRolesByOrgId).mockClear();

    ctrl.emit({ type: 'role:changed', orgId: 'other-org' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getRolesByOrgId).not.toHaveBeenCalled();
  });

  it('skill:changed event always triggers reload', async () => {
    vi.mocked(ctrl.api.getSkills).mockResolvedValue({ ok: true, data: [skill('s1')] });
    useOrganizationStore.getState().init();

    ctrl.emit({ type: 'skill:changed' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getSkills).toHaveBeenCalled();
  });

  it('loadTemplate returns new org on success', async () => {
    vi.mocked(ctrl.api.loadTemplate).mockResolvedValue({
      ok: true,
      data: {
        id: 'new',
        name: 'n',
        description: '',
        customInstructions: '',
        status: 'active',
        budgetLimit: 50,
        autoStartOnCreate: true,
        orgTemplateId: null,
        planningRoleId: null,
        workspacePath: '/tmp',
        createdAt: '',
        updatedAt: '',
      },
    });
    const org = await useOrganizationStore.getState().loadTemplate('tpl', 'n', '/tmp');
    expect(org?.id).toBe('new');
  });
});
