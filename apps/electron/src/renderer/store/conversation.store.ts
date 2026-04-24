import { create } from 'zustand';
import type { ConversationRecord, ConversationMessageRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface ConversationState {
  conversations: ConversationRecord[];
  activeConversations: ConversationRecord[];
  messages: ConversationMessageRecord[];
  currentOrgId: string | null;
  selectedConversationId: string | null;
  isLoading: boolean;
  waitingAIConversationIds: Set<string>;
  isInitialized: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedConversationId: (id: string | null) => void;
  loadConversations: (orgId: string) => Promise<void>;
  loadActiveConversations: (orgId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  resolve: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  markWaitingAI: (conversationId: string) => void;
  clearWaitingAI: (conversationId: string) => void;
  init: () => void;
}

let conversationUnsubscribe: (() => void) | null = null;

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversations: [],
  messages: [],
  currentOrgId: null,
  selectedConversationId: null,
  isLoading: false,
  waitingAIConversationIds: new Set(),
  isInitialized: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedConversationId: (id) => set({ selectedConversationId: id }),

  markWaitingAI: (conversationId) => set((s) => {
    const ids = new Set(s.waitingAIConversationIds);
    ids.add(conversationId);
    return { waitingAIConversationIds: ids };
  }),
  clearWaitingAI: (conversationId) => set((s) => {
    const ids = new Set(s.waitingAIConversationIds);
    ids.delete(conversationId);
    return { waitingAIConversationIds: ids };
  }),

  loadConversations: async (orgId) => {
    set({ isLoading: true });
    const result = await api().getConversations(orgId);
    if (result.ok) {
      set({ conversations: result.data, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  loadActiveConversations: async (orgId) => {
    const result = await api().getActiveConversations(orgId);
    if (result.ok) set({ activeConversations: result.data });
  },

  loadMessages: async (conversationId) => {
    const result = await api().getConversationMessages(conversationId);
    if (result.ok) set({ messages: result.data });
  },

  resolve: async (id) => {
    const result = await api().resolveConversation(id);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) await get().loadConversations(currentOrgId);
      return true;
    }
    return false;
  },

  cancel: async (id) => {
    const result = await api().cancelConversation(id);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) await get().loadConversations(currentOrgId);
      return true;
    }
    return false;
  },

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    if (conversationUnsubscribe) conversationUnsubscribe();
    conversationUnsubscribe = subscribeToEvents({
      'conversation:changed': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) {
          void get().loadConversations(currentOrgId);
          void get().loadActiveConversations(currentOrgId);
        }
      },
      'conversation:response-needed': (e) => {
        const { currentOrgId, selectedConversationId } = get();
        if (currentOrgId && e.orgId === currentOrgId) {
          void get().loadActiveConversations(currentOrgId);
        }
        if (selectedConversationId === e.conversationId) {
          void get().loadMessages(e.conversationId);
        }
      },
    });
  },
}));
