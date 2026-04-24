import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';

describe('usePlanningStore', () => {
  let ctrl: MockCapibaraApiController;
  let usePlanningStore: typeof import('@renderer/store/planning.store').usePlanningStore;

  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    usePlanningStore = (await import('@renderer/store/planning.store')).usePlanningStore;
  });

  it('start returns conversationId on success', async () => {
    vi.mocked(ctrl.api.startPlanning).mockResolvedValue({ ok: true, data: { conversationId: 'cv-1' } });
    const id = await usePlanningStore.getState().start('org-1', 'role-1', 'plan x');
    expect(id).toBe('cv-1');
    expect(usePlanningStore.getState().conversationId).toBe('cv-1');
  });

  it('start returns null on failure', async () => {
    vi.mocked(ctrl.api.startPlanning).mockResolvedValue({ ok: false, error: { code: 'X', message: 'err' } });
    const id = await usePlanningStore.getState().start('org-1', 'role-1', 'x');
    expect(id).toBeNull();
    expect(usePlanningStore.getState().isLoading).toBe(false);
  });

  it('confirmPlan clears state on success', async () => {
    usePlanningStore.setState({
      conversationId: 'cv-1',
      pendingPlan: { conversationId: 'cv-1', orgId: 'o', roleId: 'r', tasks: [], submittedAt: '' },
    });
    vi.mocked(ctrl.api.confirmPlan).mockResolvedValue({ ok: true, data: null });

    const ok = await usePlanningStore.getState().confirmPlan('cv-1', 'o', null);

    expect(ok).toBe(true);
    expect(usePlanningStore.getState().pendingPlan).toBeNull();
    expect(usePlanningStore.getState().conversationId).toBeNull();
  });

  it('discardPlan clears state on success', async () => {
    usePlanningStore.setState({
      conversationId: 'cv-1',
      pendingPlan: { conversationId: 'cv-1', orgId: 'o', roleId: 'r', tasks: [], submittedAt: '' },
    });
    vi.mocked(ctrl.api.discardPlan).mockResolvedValue({ ok: true, data: null });

    const ok = await usePlanningStore.getState().discardPlan('cv-1');

    expect(ok).toBe(true);
    expect(usePlanningStore.getState().pendingPlan).toBeNull();
  });

  it('planning:plan-ready sets banner and reloads pending plan', async () => {
    usePlanningStore.setState({ conversationId: 'cv-1' });
    vi.mocked(ctrl.api.getPendingPlan).mockResolvedValue({
      ok: true,
      data: { conversationId: 'cv-1', orgId: 'o', roleId: 'r', tasks: [{ title: 'T' }], submittedAt: '' },
    });
    usePlanningStore.getState().init();

    ctrl.emit({ type: 'planning:plan-ready', orgId: 'o', taskCount: 3 });
    await new Promise((r) => setTimeout(r, 0));

    expect(usePlanningStore.getState().planReadyBanner?.taskCount).toBe(3);
    expect(ctrl.api.getPendingPlan).toHaveBeenCalledWith('cv-1');
  });

  it('dismissBanner clears the ready banner', () => {
    usePlanningStore.setState({ planReadyBanner: { taskCount: 5 } });
    usePlanningStore.getState().dismissBanner();
    expect(usePlanningStore.getState().planReadyBanner).toBeNull();
  });

  it('reset zeroes out state', () => {
    usePlanningStore.setState({
      conversationId: 'cv-1',
      pendingPlan: { conversationId: 'cv-1', orgId: 'o', roleId: 'r', tasks: [], submittedAt: '' },
      isLoading: true,
    });
    usePlanningStore.getState().reset();
    expect(usePlanningStore.getState().conversationId).toBeNull();
    expect(usePlanningStore.getState().pendingPlan).toBeNull();
    expect(usePlanningStore.getState().isLoading).toBe(false);
  });
});
