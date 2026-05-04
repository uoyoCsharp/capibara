import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { PendingTreeRecord } from '@core/shared/types';

const SAMPLE_TREE: PendingTreeRecord = {
  id: 'pt-1',
  rootTaskId: 'task-root',
  orgId: 'org-1',
  roleId: 'role-cto',
  mode: 'preview',
  tree: {
    type: 'epic', title: 'Root', description: 'desc', assigneeRoleId: 'role-cto',
    children: [
      { type: 'story', title: 'S1', description: 'd', assigneeRoleId: 'role-dev', children: [] },
    ],
  },
  submittedAt: new Date().toISOString(),
  version: 1,
  status: 'active',
  pendingFeedback: null,
  conversationId: 'conv-1',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  reviewedAt: null,
};

let ctrl: MockCapibaraApiController;
let usePlanTreeStore: typeof import('@renderer/store/plan-tree.store').usePlanTreeStore;

describe('usePlanTreeStore', () => {
  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    usePlanTreeStore = (await import('@renderer/store/plan-tree.store')).usePlanTreeStore;
  });

  it('ST-01: loadPlanTree populates byRootTaskId on success', async () => {
    vi.mocked(ctrl.api.getPlanTree).mockResolvedValue({ ok: true, data: SAMPLE_TREE });

    await usePlanTreeStore.getState().loadPlanTree('task-root');

    expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toEqual(SAMPLE_TREE);
    expect(usePlanTreeStore.getState().loading['task-root']).toBe(false);
  });

  it('ST-02: loadPlanTree removes entry when server returns null', async () => {
    usePlanTreeStore.setState({ byRootTaskId: { 'task-root': SAMPLE_TREE } });
    vi.mocked(ctrl.api.getPlanTree).mockResolvedValue({ ok: true, data: null });

    await usePlanTreeStore.getState().loadPlanTree('task-root');

    expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toBeUndefined();
  });

  it('ST-03: approve removes entry on success', async () => {
    usePlanTreeStore.setState({ byRootTaskId: { 'task-root': SAMPLE_TREE } });
    vi.mocked(ctrl.api.approvePlanTree).mockResolvedValue({ ok: true, data: null });

    const ok = await usePlanTreeStore.getState().approve('task-root');

    expect(ok).toBe(true);
    expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toBeUndefined();
    expect(ctrl.api.approvePlanTree).toHaveBeenCalledWith('task-root', 1);
  });

  it('ST-04: approve sets lastError on failure', async () => {
    usePlanTreeStore.setState({ byRootTaskId: { 'task-root': SAMPLE_TREE } });
    vi.mocked(ctrl.api.approvePlanTree).mockResolvedValue({
      ok: false, error: { code: 'CONFLICT', message: 'version mismatch' },
    } as never);

    const ok = await usePlanTreeStore.getState().approve('task-root');

    expect(ok).toBe(false);
    expect(usePlanTreeStore.getState().lastError['task-root']).toBe('version mismatch');
  });

  it('ST-05: discard removes entry on success', async () => {
    usePlanTreeStore.setState({ byRootTaskId: { 'task-root': SAMPLE_TREE } });
    vi.mocked(ctrl.api.discardPlanTree).mockResolvedValue({ ok: true, data: null });

    const ok = await usePlanTreeStore.getState().discard('task-root', 'not needed');

    expect(ok).toBe(true);
    expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toBeUndefined();
    expect(ctrl.api.discardPlanTree).toHaveBeenCalledWith('task-root', 'not needed');
  });

  it('ST-06: refine sets refining flag and clears on success', async () => {
    vi.mocked(ctrl.api.refinePlanTree).mockResolvedValue({ ok: true, data: null });

    const ok = await usePlanTreeStore.getState().refine('task-root', 'add more detail');

    expect(ok).toBe(true);
    expect(ctrl.api.refinePlanTree).toHaveBeenCalledWith('task-root', 'add more detail');
  });

  it('ST-07: refine resets refining flag on failure', async () => {
    vi.mocked(ctrl.api.refinePlanTree).mockResolvedValue({
      ok: false, error: { code: 'INTERNAL', message: 'refine failed' },
    } as never);

    const ok = await usePlanTreeStore.getState().refine('task-root', 'feedback');

    expect(ok).toBe(false);
    expect(usePlanTreeStore.getState().refining['task-root']).toBe(false);
    expect(usePlanTreeStore.getState().lastError['task-root']).toBe('refine failed');
  });

  describe('event subscriptions', () => {
    it('ST-08: plan-tree:ready triggers loadPlanTree', async () => {
      vi.mocked(ctrl.api.getPlanTree).mockResolvedValue({ ok: true, data: SAMPLE_TREE });

      usePlanTreeStore.getState().init();

      ctrl.emit({
        type: 'plan-tree:ready',
        orgId: 'org-1',
        rootTaskId: 'task-root',
        nodeCount: 2,
        maxDepth: 2,
      });

      // Wait for async loadPlanTree to settle
      await vi.waitFor(() => {
        expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toBeDefined();
      });
    });

    it('ST-09: plan-tree:discarded removes entry from store', () => {
      usePlanTreeStore.setState({
        byRootTaskId: { 'task-root': SAMPLE_TREE },
        refining: { 'task-root': true },
      });

      usePlanTreeStore.getState().init();

      ctrl.emit({ type: 'plan-tree:discarded', orgId: 'org-1', rootTaskId: 'task-root' });

      expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toBeUndefined();
      expect(usePlanTreeStore.getState().refining['task-root']).toBe(false);
    });

    it('ST-10: plan-tree:approved removes entry from store', () => {
      usePlanTreeStore.setState({
        byRootTaskId: { 'task-root': SAMPLE_TREE },
        refining: { 'task-root': false },
      });

      usePlanTreeStore.getState().init();

      ctrl.emit({ type: 'plan-tree:approved', orgId: 'org-1', rootTaskId: 'task-root' });

      expect(usePlanTreeStore.getState().byRootTaskId['task-root']).toBeUndefined();
    });
  });
});
