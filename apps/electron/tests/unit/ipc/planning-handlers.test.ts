import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the planning-related IPC handlers that live in
 * conversation.handlers.ts (not plan-tree.handlers.ts):
 *   - capibara:planning:start
 *   - capibara:planning:active
 *
 * These are thin wrappers over ConversationService.createPlanning and
 * ConversationService.findActiveByOrgId. The parity with the service layer
 * is the only behaviour worth asserting at the IPC level.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

import { registerConversationHandlers } from '@core/ipc-handlers/conversation.handlers';

function createMockConversationService() {
  return {
    findByOrgId: vi.fn().mockReturnValue([]),
    findActiveByOrgId: vi.fn().mockReturnValue([]),
    findById: vi.fn().mockReturnValue(null),
    getMessages: vi.fn().mockReturnValue([]),
    addMessage: vi.fn(),
    resolve: vi.fn(),
    cancel: vi.fn(),
    createInquiry: vi.fn(),
    createPlanningOrAdhoc: vi.fn(),
    createPlanning: vi.fn(),
  };
}

function sampleConversation(overrides?: Record<string, unknown>) {
  return {
    id: 'conv-plan-1',
    orgId: 'org-1',
    type: 'planning',
    state: 'waiting',
    initiatorRoleId: 'role-pm',
    respondentRoleId: 'role-pm',
    respondentType: 'ai',
    taskId: null,
    parentConversationId: null,
    depth: 0,
    externalSessionId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('planning IPC handlers (in conversation.handlers.ts)', () => {
  let svc: ReturnType<typeof createMockConversationService>;

  beforeEach(() => {
    handlers.clear();
    svc = createMockConversationService();
    registerConversationHandlers(svc as never);
  });

  function invoke(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({}, ...args);
  }

  describe('capibara:planning:start', () => {
    it('PH-01: creates planning conversation and returns it', async () => {
      const conv = sampleConversation();
      svc.createPlanning.mockReturnValue(conv);
      const result = await invoke(
        'capibara:planning:start',
        'org-1',
        'role-pm',
        'I want to build a note-taking app',
      );
      expect(result).toEqual({ ok: true, data: conv });
      expect(svc.createPlanning).toHaveBeenCalledWith(
        'org-1',
        'role-pm',
        'I want to build a note-taking app',
      );
    });

    it('PH-02: wraps service errors as VALIDATION_ERROR', async () => {
      svc.createPlanning.mockImplementation(() => {
        throw new Error('org not found');
      });
      const result = await invoke('capibara:planning:start', 'org-missing', 'role-pm', 'hi');
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('org not found') },
      });
    });

    it('PH-03: passes through whitespace-only message verbatim (service decides)', async () => {
      const conv = sampleConversation();
      svc.createPlanning.mockReturnValue(conv);
      await invoke('capibara:planning:start', 'org-1', 'role-pm', '   ');
      expect(svc.createPlanning).toHaveBeenCalledWith('org-1', 'role-pm', '   ');
    });
  });

  describe('capibara:planning:active', () => {
    it('PH-10: returns ok(null) when no active planning conversation', async () => {
      svc.findActiveByOrgId.mockReturnValue([]);
      const result = await invoke('capibara:planning:active', 'org-1');
      expect(result).toEqual({ ok: true, data: null });
      expect(svc.findActiveByOrgId).toHaveBeenCalledWith('org-1');
    });

    it('PH-11: returns the planning conversation when found', async () => {
      const planning = sampleConversation({ type: 'planning' });
      svc.findActiveByOrgId.mockReturnValue([planning]);
      const result = await invoke('capibara:planning:active', 'org-1');
      expect(result).toEqual({ ok: true, data: planning });
    });

    it('PH-12: skips non-planning active conversations (inquiry, adhoc, plan_review)', async () => {
      const inquiry = sampleConversation({ id: 'conv-inq', type: 'inquiry' });
      const adhoc = sampleConversation({ id: 'conv-ah', type: 'adhoc' });
      const review = sampleConversation({ id: 'conv-pr', type: 'plan_review' });
      svc.findActiveByOrgId.mockReturnValue([inquiry, adhoc, review]);
      const result = await invoke('capibara:planning:active', 'org-1');
      expect(result).toEqual({ ok: true, data: null });
    });

    it('PH-13: returns the first planning conversation if multiple exist (MVP invariant: should be at most one)', async () => {
      const p1 = sampleConversation({ id: 'first', type: 'planning' });
      const p2 = sampleConversation({ id: 'second', type: 'planning' });
      svc.findActiveByOrgId.mockReturnValue([p1, p2]);
      const result = await invoke('capibara:planning:active', 'org-1');
      expect(result).toEqual({ ok: true, data: p1 });
    });

    it('PH-14: catches service exceptions as INTERNAL', async () => {
      svc.findActiveByOrgId.mockImplementation(() => {
        throw new Error('repo failure');
      });
      const result = await invoke('capibara:planning:active', 'org-1');
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INTERNAL', message: expect.stringContaining('repo failure') },
      });
    });
  });
});
