import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { OrganizationRecord } from '@core/shared/types';

describe('useAppStore', () => {
  let ctrl: MockCapibaraApiController;
  let useAppStore: typeof import('@renderer/store/app.store').useAppStore;

  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    useAppStore = (await import('@renderer/store/app.store')).useAppStore;
  });

  const org = (id: string, overrides?: Partial<OrganizationRecord>): OrganizationRecord => ({
    id,
    name: `Org ${id}`,
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
    ...overrides,
  });

  it('loadOrganizations populates state on success', async () => {
    vi.mocked(ctrl.api.getOrganizations).mockResolvedValue({ ok: true, data: [org('o1'), org('o2')] });

    await useAppStore.getState().loadOrganizations();

    const s = useAppStore.getState();
    expect(s.organizations).toHaveLength(2);
    expect(s.currentOrgId).toBe('o1');
    expect(s.isLoading).toBe(false);
  });

  it('loadOrganizations keeps currentOrgId if it is still valid', async () => {
    useAppStore.setState({ currentOrgId: 'pre' });
    vi.mocked(ctrl.api.getOrganizations).mockResolvedValue({ ok: true, data: [org('pre'), org('o1')] });

    await useAppStore.getState().loadOrganizations();

    expect(useAppStore.getState().currentOrgId).toBe('pre');
  });

  it('loadOrganizations handles error result gracefully', async () => {
    vi.mocked(ctrl.api.getOrganizations).mockResolvedValue({ ok: false, error: { code: 'X', message: 'm' } });

    await useAppStore.getState().loadOrganizations();

    expect(useAppStore.getState().isLoading).toBe(false);
    expect(useAppStore.getState().organizations).toEqual([]);
  });

  it('init subscribes and reloads on org:changed', async () => {
    vi.mocked(ctrl.api.getOrganizations).mockResolvedValue({ ok: true, data: [org('o1')] });
    useAppStore.getState().init();

    // initial call from init
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getOrganizations).toHaveBeenCalledTimes(1);

    ctrl.emit({ type: 'org:changed', orgId: 'o1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getOrganizations).toHaveBeenCalledTimes(2);
  });

  it('init is idempotent', () => {
    useAppStore.getState().init();
    useAppStore.getState().init();
    useAppStore.getState().init();
    expect(ctrl.subscriberCount()).toBe(1);
  });

  it('snapshot:updated also triggers reload', async () => {
    vi.mocked(ctrl.api.getOrganizations).mockResolvedValue({ ok: true, data: [] });
    useAppStore.getState().init();
    await new Promise((r) => setTimeout(r, 0));

    ctrl.emit({ type: 'snapshot:updated' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getOrganizations).toHaveBeenCalledTimes(2);
  });
});
