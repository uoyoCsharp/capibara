import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { RunRecord } from '@core/shared/types';

function run(id: string, overrides?: Partial<RunRecord>): RunRecord {
  return {
    id,
    orgId: 'org-1',
    taskId: 't1',
    conversationId: null,
    roleId: 'role-1',
    status: 'queued',
    wakeReason: 'task_assigned',
    startedAt: null,
    finishedAt: null,
    costUsd: 0,
    tokenCount: 0,
    summary: null,
    errorMessage: null,
    createdAt: '',
    ...overrides,
  };
}

describe('useRunStore', () => {
  let ctrl: MockCapibaraApiController;
  let useRunStore: typeof import('@renderer/store/run.store').useRunStore;

  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    useRunStore = (await import('@renderer/store/run.store')).useRunStore;
  });

  it('loadRuns populates runs', async () => {
    vi.mocked(ctrl.api.getRunsByOrgId).mockResolvedValue({ ok: true, data: [run('r1')] });
    await useRunStore.getState().loadRuns('org-1');
    expect(useRunStore.getState().runs).toHaveLength(1);
  });

  it('cancelRun reloads on success', async () => {
    useRunStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.cancelRun).mockResolvedValue({ ok: true, data: null });
    vi.mocked(ctrl.api.getRunsByOrgId).mockResolvedValue({ ok: true, data: [] });
    await useRunStore.getState().cancelRun('r1');
    expect(ctrl.api.getRunsByOrgId).toHaveBeenCalledWith('org-1');
  });

  it('refreshRun replaces the matching run in the list', async () => {
    useRunStore.setState({ runs: [run('r1', { status: 'running' })] });
    vi.mocked(ctrl.api.getRun).mockResolvedValue({ ok: true, data: run('r1', { status: 'succeeded' }) });
    await useRunStore.getState().refreshRun('r1');
    expect(useRunStore.getState().runs[0].status).toBe('succeeded');
  });

  it('refreshRun with unknown id leaves list unchanged', async () => {
    useRunStore.setState({ runs: [run('r1')] });
    vi.mocked(ctrl.api.getRun).mockResolvedValue({ ok: true, data: null });
    await useRunStore.getState().refreshRun('r1');
    expect(useRunStore.getState().runs).toHaveLength(1);
  });

  it('run:completed for current org reloads', async () => {
    useRunStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getRunsByOrgId).mockResolvedValue({ ok: true, data: [] });
    useRunStore.getState().init();
    vi.mocked(ctrl.api.getRunsByOrgId).mockClear();

    ctrl.emit({ type: 'run:completed', runId: 'r1', orgId: 'org-1', status: 'succeeded', tokenCount: 10 });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getRunsByOrgId).toHaveBeenCalled();
  });

  it('run:status delegates to refreshRun', async () => {
    vi.mocked(ctrl.api.getRun).mockResolvedValue({ ok: true, data: run('r1') });
    useRunStore.getState().init();

    ctrl.emit({ type: 'run:status', runId: 'r1', status: 'running' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getRun).toHaveBeenCalledWith('r1');
  });

  it('init is idempotent', () => {
    useRunStore.getState().init();
    useRunStore.getState().init();
    expect(ctrl.subscriberCount()).toBe(1);
  });
});
