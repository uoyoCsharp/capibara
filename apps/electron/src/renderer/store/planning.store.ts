import { create } from 'zustand';
import type { PendingPlanRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface PlanningState {
  conversationId: string | null;
  pendingPlan: PendingPlanRecord | null;
  isLoading: boolean;
  planReadyBanner: { taskCount: number } | null;
  isInitialized: boolean;

  start: (orgId: string, roleId: string, message: string) => Promise<string | null>;
  sendMessage: (conversationId: string, message: string) => Promise<void>;
  loadPendingPlan: (conversationId: string) => Promise<void>;
  confirmPlan: (conversationId: string, orgId: string, parentTaskId: string | null) => Promise<boolean>;
  discardPlan: (conversationId: string) => Promise<boolean>;
  dismissBanner: () => void;
  reset: () => void;
  init: () => void;
}

let planningUnsubscribe: (() => void) | null = null;

export const usePlanningStore = create<PlanningState>((set, get) => ({
  conversationId: null,
  pendingPlan: null,
  isLoading: false,
  planReadyBanner: null,
  isInitialized: false,

  start: async (orgId, roleId, message) => {
    set({ isLoading: true });
    const result = await api().startPlanning(orgId, roleId, message);
    if (result.ok) {
      const convId = result.data.conversationId;
      set({ conversationId: convId, isLoading: false });
      return convId;
    }
    set({ isLoading: false });
    return null;
  },

  sendMessage: async (conversationId, message) => {
    await api().sendPlanningMessage(conversationId, message);
  },

  loadPendingPlan: async (conversationId) => {
    const result = await api().getPendingPlan(conversationId);
    if (result.ok) {
      set({ pendingPlan: result.data ?? null });
    }
  },

  confirmPlan: async (conversationId, orgId, parentTaskId) => {
    const result = await api().confirmPlan(conversationId, orgId, parentTaskId);
    if (result.ok) {
      set({ pendingPlan: null, conversationId: null });
      return true;
    }
    return false;
  },

  discardPlan: async (conversationId) => {
    const result = await api().discardPlan(conversationId);
    if (result.ok) {
      set({ pendingPlan: null, conversationId: null });
      return true;
    }
    return false;
  },

  dismissBanner: () => set({ planReadyBanner: null }),

  reset: () => set({ conversationId: null, pendingPlan: null, isLoading: false }),

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    if (planningUnsubscribe) planningUnsubscribe();
    planningUnsubscribe = subscribeToEvents({
      'planning:plan-ready': (e) => {
        set({ planReadyBanner: { taskCount: e.taskCount } });
        const convId = get().conversationId;
        if (convId) void get().loadPendingPlan(convId);
      },
    });
  },
}));
