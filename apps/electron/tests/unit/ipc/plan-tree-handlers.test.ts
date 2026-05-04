import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for plan-tree IPC handlers. We mock ipcMain.handle and PlanningService
 * to verify each channel correctly translates between IPC and the service layer.
 */

// Collect registered handlers
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

import { registerPlanTreeHandlers } from '@core/ipc-handlers/plan-tree.handlers';

function createMockPlanningService() {
  return {
    getPendingTree: vi.fn(),
    approvePlanTree: vi.fn(),
    discardPlanTree: vi.fn(),
    refinePlanTree: vi.fn(),
  };
}

describe('plan-tree IPC handlers', () => {
  let svc: ReturnType<typeof createMockPlanningService>;

  beforeEach(() => {
    handlers.clear();
    svc = createMockPlanningService();
    registerPlanTreeHandlers(svc as never);
  });

  function invoke(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({}, ...args);
  }

  describe('capibara:plan-tree:get', () => {
    it('IPC-01: returns ok(null) when no pending tree', async () => {
      svc.getPendingTree.mockReturnValue(undefined);
      const result = await invoke('capibara:plan-tree:get', 'task-root');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.getPendingTree).toHaveBeenCalledWith('task-root');
    });

    it('IPC-02: returns PendingTreeRecord when tree exists', async () => {
      svc.getPendingTree.mockReturnValue({
        id: 'pt-1', rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview', tree: { type: 'epic', title: 'R', description: '', assigneeRoleId: 'r', children: [] },
        submittedAt: '2025-01-01T00:00:00Z', version: 1, status: 'active',
        pendingFeedback: null, conversationId: 'conv-1', expiresAt: '2025-01-02T00:00:00Z', reviewedAt: null,
      });
      const result = await invoke('capibara:plan-tree:get', 'task-root');
      expect(result).toEqual({
        ok: true,
        data: expect.objectContaining({ id: 'pt-1', rootTaskId: 'task-root', version: 1 }),
      });
    });
  });

  describe('capibara:plan-tree:approve', () => {
    it('IPC-03: returns ok(null) when service returns ok', async () => {
      svc.approvePlanTree.mockReturnValue({ ok: true });
      const result = await invoke('capibara:plan-tree:approve', 'task-root', 1);
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.approvePlanTree).toHaveBeenCalledWith('task-root', 1);
    });

    it('IPC-03b: returns error when service returns failure', async () => {
      svc.approvePlanTree.mockReturnValue({ ok: false, code: 'VERSION_MISMATCH', message: 'outdated' });
      const result = await invoke('capibara:plan-tree:approve', 'task-root', 1);
      expect(result).toEqual({ ok: false, error: { code: 'VERSION_MISMATCH', message: 'outdated' } });
    });
  });

  describe('capibara:plan-tree:discard', () => {
    it('IPC-04: returns ok(null) on success', async () => {
      svc.discardPlanTree.mockReturnValue({ ok: true });
      const result = await invoke('capibara:plan-tree:discard', 'task-root', 'not needed');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.discardPlanTree).toHaveBeenCalledWith('task-root', 'not needed');
    });

    it('IPC-04b: passes null when reason is undefined', async () => {
      svc.discardPlanTree.mockReturnValue({ ok: true });
      await invoke('capibara:plan-tree:discard', 'task-root');
      expect(svc.discardPlanTree).toHaveBeenCalledWith('task-root', null);
    });
  });

  describe('capibara:plan-tree:refine', () => {
    it('IPC-05: returns ok(null) on success', async () => {
      svc.refinePlanTree.mockReturnValue({ ok: true });
      const result = await invoke('capibara:plan-tree:refine', 'task-root', 'more detail');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.refinePlanTree).toHaveBeenCalledWith('task-root', 'more detail');
    });

    it('IPC-05b: returns error on service failure', async () => {
      svc.refinePlanTree.mockReturnValue({ ok: false, code: 'NO_PENDING_TREE', message: 'not found' });
      const result = await invoke('capibara:plan-tree:refine', 'task-root', 'feedback');
      expect(result).toEqual({ ok: false, error: { code: 'NO_PENDING_TREE', message: 'not found' } });
    });
  });

  it('IPC-ERR: handler catches exceptions and returns INTERNAL error', async () => {
    svc.getPendingTree.mockImplementation(() => { throw new Error('DB crash'); });
    const result = await invoke('capibara:plan-tree:get', 'task-root');
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Error: DB crash' } });
  });
});
