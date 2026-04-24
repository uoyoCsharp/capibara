import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { TaskRecord } from '@core/shared/types';

function task(id: string, overrides?: Partial<TaskRecord>): TaskRecord {
  return {
    id,
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: `T ${id}`,
    description: '',
    status: 'pending',
    assigneeRoleId: 'role-1',
    depth: 0,
    artifactPaths: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('useTaskStore', () => {
  let ctrl: MockCapibaraApiController;
  let useTaskStore: typeof import('@renderer/store/task.store').useTaskStore;

  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    useTaskStore = (await import('@renderer/store/task.store')).useTaskStore;
  });

  it('loadTasks populates state', async () => {
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [task('t1'), task('t2')] });
    await useTaskStore.getState().loadTasks('org-1');
    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(useTaskStore.getState().isLoading).toBe(false);
  });

  it('loadTasks sets isLoading false even on failure', async () => {
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: false, error: { code: 'X', message: 'err' } });
    await useTaskStore.getState().loadTasks('org-1');
    expect(useTaskStore.getState().isLoading).toBe(false);
  });

  it('createTask reloads tasks on success', async () => {
    useTaskStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.createTask).mockResolvedValue({ ok: true, data: task('new') });
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [task('new')] });

    const created = await useTaskStore.getState().createTask({ title: 'X' });

    expect(created?.id).toBe('new');
    expect(ctrl.api.getTasksByOrgId).toHaveBeenCalledWith('org-1');
  });

  it('deleteTask clears selection if the deleted task was selected', async () => {
    useTaskStore.setState({ currentOrgId: 'org-1', selectedTaskId: 't-del' });
    vi.mocked(ctrl.api.deleteTask).mockResolvedValue({ ok: true, data: null });
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [] });

    await useTaskStore.getState().deleteTask('t-del');

    expect(useTaskStore.getState().selectedTaskId).toBeNull();
  });

  it('task:changed event for current org triggers reload', async () => {
    useTaskStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [] });
    useTaskStore.getState().init();

    ctrl.emit({ type: 'task:changed', orgId: 'org-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getTasksByOrgId).toHaveBeenCalledWith('org-1');
  });

  it('task:changed event for a different org does nothing', async () => {
    useTaskStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [] });
    useTaskStore.getState().init();
    vi.mocked(ctrl.api.getTasksByOrgId).mockClear();

    ctrl.emit({ type: 'task:changed', orgId: 'org-OTHER' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getTasksByOrgId).not.toHaveBeenCalled();
  });

  it('task:entered-approval for current org reloads', async () => {
    useTaskStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [] });
    useTaskStore.getState().init();
    vi.mocked(ctrl.api.getTasksByOrgId).mockClear();

    ctrl.emit({ type: 'task:entered-approval', taskId: 't1', orgId: 'org-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getTasksByOrgId).toHaveBeenCalled();
  });

  it('init is idempotent', () => {
    useTaskStore.getState().init();
    useTaskStore.getState().init();
    expect(ctrl.subscriberCount()).toBe(1);
  });
});
