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
    getPendingTreeByConversation: vi.fn(),
    approvePlanTreeByConversation: vi.fn(),
    discardPlanTreeByConversation: vi.fn(),
    refinePlanTreeByConversation: vi.fn(),
  };
}

function samplePending(overrides?: Record<string, unknown>) {
  return {
    id: 'pt-1',
    rootTaskId: 'task-root',
    sourceConversationId: null,
    orgId: 'org-1',
    roleId: 'role-cto',
    mode: 'preview',
    tree: { type: 'epic', title: 'R', description: '', assigneeRoleId: 'r', children: [] },
    submittedAt: '2026-01-01T00:00:00Z',
    version: 1,
    status: 'active',
    pendingFeedback: null,
    conversationId: 'conv-review-1',
    expiresAt: '2026-01-02T00:00:00Z',
    reviewedAt: null,
    ...overrides,
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
      svc.getPendingTree.mockReturnValue(samplePending());
      const result = await invoke('capibara:plan-tree:get', 'task-root');
      expect(result).toEqual({
        ok: true,
        data: expect.objectContaining({
          id: 'pt-1',
          rootTaskId: 'task-root',
          sourceConversationId: null,
          version: 1,
        }),
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

  // ─── Conversation-anchored plan tree handlers ────────────────

  describe('capibara:plan-tree:get-by-conversation', () => {
    it('IPC-C-01: returns ok(null) when no pending tree for conversation', async () => {
      svc.getPendingTreeByConversation.mockReturnValue(undefined);
      const result = await invoke('capibara:plan-tree:get-by-conversation', 'conv-plan-1');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.getPendingTreeByConversation).toHaveBeenCalledWith('conv-plan-1');
    });

    it('IPC-C-02: returns serialized tree with null rootTaskId + sourceConversationId', async () => {
      svc.getPendingTreeByConversation.mockReturnValue(samplePending({
        rootTaskId: null,
        sourceConversationId: 'conv-plan-1',
        conversationId: null,
      }));
      const result = await invoke('capibara:plan-tree:get-by-conversation', 'conv-plan-1');
      expect(result).toEqual({
        ok: true,
        data: expect.objectContaining({
          rootTaskId: null,
          sourceConversationId: 'conv-plan-1',
          conversationId: null,
        }),
      });
    });

    it('IPC-C-03: catches exceptions and returns INTERNAL', async () => {
      svc.getPendingTreeByConversation.mockImplementation(() => { throw new Error('boom'); });
      const result = await invoke('capibara:plan-tree:get-by-conversation', 'conv-plan-1');
      expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Error: boom' } });
    });
  });

  describe('capibara:plan-tree:approve-by-conversation', () => {
    it('IPC-C-04: returns ok(null) when service approves', async () => {
      svc.approvePlanTreeByConversation.mockReturnValue({ ok: true });
      const result = await invoke('capibara:plan-tree:approve-by-conversation', 'conv-plan-1', 2);
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.approvePlanTreeByConversation).toHaveBeenCalledWith('conv-plan-1', 2);
    });

    it('IPC-C-04b: forwards service error codes unchanged', async () => {
      svc.approvePlanTreeByConversation.mockReturnValue({
        ok: false,
        code: 'VERSION_MISMATCH',
        message: 'tree updated to v3',
      });
      const result = await invoke('capibara:plan-tree:approve-by-conversation', 'conv-plan-1', 2);
      expect(result).toEqual({
        ok: false,
        error: { code: 'VERSION_MISMATCH', message: 'tree updated to v3' },
      });
    });

    it('IPC-C-04c: passes undefined expectedVersion transparently', async () => {
      svc.approvePlanTreeByConversation.mockReturnValue({ ok: true });
      await invoke('capibara:plan-tree:approve-by-conversation', 'conv-plan-1');
      expect(svc.approvePlanTreeByConversation).toHaveBeenCalledWith('conv-plan-1', undefined);
    });

    it('IPC-C-04d: falls back to default message when service omits it', async () => {
      svc.approvePlanTreeByConversation.mockReturnValue({ ok: false, code: 'NO_PENDING_TREE' });
      const result = await invoke('capibara:plan-tree:approve-by-conversation', 'conv-plan-1');
      expect(result).toEqual({
        ok: false,
        error: { code: 'NO_PENDING_TREE', message: 'Approve failed' },
      });
    });
  });

  describe('capibara:plan-tree:discard-by-conversation', () => {
    it('IPC-C-05: returns ok(null) on success and forwards reason', async () => {
      svc.discardPlanTreeByConversation.mockReturnValue({ ok: true });
      const result = await invoke('capibara:plan-tree:discard-by-conversation', 'conv-plan-1', 'changed-mind');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.discardPlanTreeByConversation).toHaveBeenCalledWith('conv-plan-1', 'changed-mind');
    });

    it('IPC-C-05b: passes null reason when undefined', async () => {
      svc.discardPlanTreeByConversation.mockReturnValue({ ok: true });
      await invoke('capibara:plan-tree:discard-by-conversation', 'conv-plan-1');
      expect(svc.discardPlanTreeByConversation).toHaveBeenCalledWith('conv-plan-1', null);
    });

    it('IPC-C-05c: surfaces service failure', async () => {
      svc.discardPlanTreeByConversation.mockReturnValue({
        ok: false,
        code: 'NO_PENDING_TREE',
        message: 'nothing to discard',
      });
      const result = await invoke('capibara:plan-tree:discard-by-conversation', 'conv-plan-1');
      expect(result).toEqual({
        ok: false,
        error: { code: 'NO_PENDING_TREE', message: 'nothing to discard' },
      });
    });
  });

  describe('capibara:plan-tree:refine-by-conversation', () => {
    it('IPC-C-06: returns ok(null) and forwards feedback', async () => {
      svc.refinePlanTreeByConversation.mockReturnValue({ ok: true });
      const result = await invoke('capibara:plan-tree:refine-by-conversation', 'conv-plan-1', 'split auth');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.refinePlanTreeByConversation).toHaveBeenCalledWith('conv-plan-1', 'split auth');
    });

    it('IPC-C-06b: surfaces EMPTY_FEEDBACK from service', async () => {
      svc.refinePlanTreeByConversation.mockReturnValue({
        ok: false,
        code: 'EMPTY_FEEDBACK',
        message: 'Feedback must not be empty.',
      });
      const result = await invoke('capibara:plan-tree:refine-by-conversation', 'conv-plan-1', '   ');
      expect(result).toEqual({
        ok: false,
        error: { code: 'EMPTY_FEEDBACK', message: 'Feedback must not be empty.' },
      });
    });

    it('IPC-C-06c: catches exceptions', async () => {
      svc.refinePlanTreeByConversation.mockImplementation(() => {
        throw new Error('unexpected');
      });
      const result = await invoke('capibara:plan-tree:refine-by-conversation', 'conv-plan-1', 'fb');
      expect(result).toEqual({
        ok: false,
        error: { code: 'INTERNAL', message: 'Error: unexpected' },
      });
    });
  });
});
