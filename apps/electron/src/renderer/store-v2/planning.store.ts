import { create } from 'zustand';
import type { PendingPlanRecord } from '@core/shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface PlanningState {
  conversationId: string | null;
  pendingPlan: PendingPlanRecord | null;
  isLoading: boolean;

  start: (orgId: string, roleId: string, message: string) => Promise<string | null>;
  sendMessage: (conversationId: string, message: string) => Promise<void>;
  loadPendingPlan: (conversationId: string) => Promise<void>;
  confirmPlan: (conversationId: string, orgId: string, parentTaskId: string | null) => Promise<boolean>;
  discardPlan: (conversationId: string) => Promise<boolean>;
  reset: () => void;
}

export const usePlanningStore = create<PlanningState>((set) => ({
  conversationId: null,
  pendingPlan: null,
  isLoading: false,

  start: async (orgId, roleId, message) => {
    set({ isLoading: true });
    const result = await api().startPlanning(orgId, roleId, message);
    if (result.ok) {
      const convId = (result.data as { conversationId: string }).conversationId;
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
      set({ pendingPlan: (result.data as PendingPlanRecord | null) ?? null });
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

  reset: () => set({ conversationId: null, pendingPlan: null, isLoading: false }),
}));
