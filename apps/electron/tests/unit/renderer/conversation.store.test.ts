import { describe, it, expect, beforeEach } from 'vitest';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { ConversationRecord } from '@core/shared/types';

function conv(id: string, overrides?: Partial<ConversationRecord>): ConversationRecord {
  return {
    id,
    orgId: 'org-1',
    type: 'inquiry',
    state: 'active',
    initiatorRoleId: 'role-1',
    respondentRoleId: null,
    respondentType: null,
    taskId: null,
    parentConversationId: null,
    depth: 0,
    priority: 0,
    timeoutAt: null,
    externalSessionId: null,
    metadata: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('useConversationStore', () => {
  let ctrl: MockCapibaraApiController;
  let useConversationStore: typeof import('@renderer/store/conversation.store').useConversationStore;

  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    useConversationStore = (await import('@renderer/store/conversation.store')).useConversationStore;
  });

  it('loadConversations populates state', async () => {
    vi.mocked(ctrl.api.getConversations).mockResolvedValue({ ok: true, data: [conv('c1')] });
    await useConversationStore.getState().loadConversations('org-1');
    expect(useConversationStore.getState().conversations).toHaveLength(1);
    expect(useConversationStore.getState().isLoading).toBe(false);
  });

  it('markWaitingAI and clearWaitingAI mutate the set correctly', () => {
    useConversationStore.getState().markWaitingAI('c1');
    expect(useConversationStore.getState().waitingAIConversationIds.has('c1')).toBe(true);
    useConversationStore.getState().clearWaitingAI('c1');
    expect(useConversationStore.getState().waitingAIConversationIds.has('c1')).toBe(false);
  });

  it('resolve triggers reload on success', async () => {
    useConversationStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.resolveConversation).mockResolvedValue({ ok: true, data: null });
    vi.mocked(ctrl.api.getConversations).mockResolvedValue({ ok: true, data: [] });
    await useConversationStore.getState().resolve('c1');
    expect(ctrl.api.getConversations).toHaveBeenCalledWith('org-1');
  });

  it('conversation:changed for current org reloads conversations + active', async () => {
    useConversationStore.getState().setCurrentOrgId('org-1');
    vi.mocked(ctrl.api.getConversations).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(ctrl.api.getActiveConversations).mockResolvedValue({ ok: true, data: [] });
    useConversationStore.getState().init();

    ctrl.emit({ type: 'conversation:changed', orgId: 'org-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getConversations).toHaveBeenCalled();
    expect(ctrl.api.getActiveConversations).toHaveBeenCalled();
  });

  it('loadPlanningHistory populates planningHistory', async () => {
    vi.mocked(ctrl.api.getPlanningHistory).mockResolvedValue({
      ok: true,
      data: [{ id: 'p1', title: 'Idea', state: 'resolved', createdAt: '', updatedAt: '' }],
    });
    await useConversationStore.getState().loadPlanningHistory('org-1');
    expect(useConversationStore.getState().planningHistory).toHaveLength(1);
    expect(ctrl.api.getPlanningHistory).toHaveBeenCalledWith('org-1');
  });

  it('loadMessages caches messages for flicker-free rehydration', async () => {
    const msgs = [{ id: 'm1', conversationId: 'c1', authorRoleId: null, authorType: 'human' as const, content: 'hi', intent: 'general' as const, inReplyToMessageId: null, createdAt: '' }];
    vi.mocked(ctrl.api.getConversationMessages).mockResolvedValue({ ok: true, data: msgs });

    await useConversationStore.getState().loadMessages('c1');

    expect(useConversationStore.getState().getCachedMessages('c1')).toEqual(msgs);
    expect(useConversationStore.getState().getCachedMessages('other')).toEqual([]);
  });

  it('setCachedMessages stores messages without an IPC round-trip', () => {
    const msgs = [{ id: 'm9', conversationId: 'c2', authorRoleId: null, authorType: 'ai' as const, content: 'cached', intent: 'reply' as const, inReplyToMessageId: null, createdAt: '' }];
    useConversationStore.getState().setCachedMessages('c2', msgs);
    expect(useConversationStore.getState().getCachedMessages('c2')).toEqual(msgs);
  });

  it('conversation:response-needed for selected conversation reloads messages', async () => {
    useConversationStore.getState().setCurrentOrgId('org-1');
    useConversationStore.getState().setSelectedConversationId('c1');
    vi.mocked(ctrl.api.getConversationMessages).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(ctrl.api.getActiveConversations).mockResolvedValue({ ok: true, data: [] });
    useConversationStore.getState().init();

    ctrl.emit({ type: 'conversation:response-needed', orgId: 'org-1', conversationId: 'c1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctrl.api.getConversationMessages).toHaveBeenCalledWith('c1');
  });
});
