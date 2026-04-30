import { create } from 'zustand';
import type { PendingTreeRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface PlanTreeState {
  byRootTaskId: Record<string, PendingTreeRecord>;
  loading: Record<string, boolean>;
  refining: Record<string, boolean>;
  lastError: Record<string, string | null>;
  readyBanner: { rootTaskId: string; nodeCount: number; maxDepth: number } | null;
  isInitialized: boolean;

  loadPlanTree: (rootTaskId: string) => Promise<void>;
  approve: (rootTaskId: string) => Promise<boolean>;
  discard: (rootTaskId: string, reason?: string) => Promise<boolean>;
  refine: (rootTaskId: string, feedback: string) => Promise<boolean>;
  clearBanner: () => void;
  init: () => void;
}

let unsubscribe: (() => void) | null = null;

export const usePlanTreeStore = create<PlanTreeState>((set, get) => ({
  byRootTaskId: {},
  loading: {},
  refining: {},
  lastError: {},
  readyBanner: null,
  isInitialized: false,

  loadPlanTree: async (rootTaskId) => {
    set((s) => ({ loading: { ...s.loading, [rootTaskId]: true } }));
    const res = await api().getPlanTree(rootTaskId);
    set((s) => ({ loading: { ...s.loading, [rootTaskId]: false } }));
    if (res.ok) {
      const data = res.data as PendingTreeRecord | null;
      if (data) {
        set((s) => ({
          byRootTaskId: { ...s.byRootTaskId, [rootTaskId]: data },
          lastError: { ...s.lastError, [rootTaskId]: null },
          refining: { ...s.refining, [rootTaskId]: false },
        }));
      } else {
        set((s) => {
          const next = { ...s.byRootTaskId };
          delete next[rootTaskId];
          return { byRootTaskId: next };
        });
      }
    }
  },

  approve: async (rootTaskId) => {
    const existing = get().byRootTaskId[rootTaskId];
    const res = await api().approvePlanTree(rootTaskId, existing?.version);
    if (res.ok) {
      set((s) => {
        const next = { ...s.byRootTaskId };
        delete next[rootTaskId];
        return { byRootTaskId: next, lastError: { ...s.lastError, [rootTaskId]: null } };
      });
      return true;
    }
    set((s) => ({ lastError: { ...s.lastError, [rootTaskId]: res.error?.message ?? 'approve failed' } }));
    return false;
  },

  discard: async (rootTaskId, reason) => {
    const res = await api().discardPlanTree(rootTaskId, reason);
    if (res.ok) {
      set((s) => {
        const next = { ...s.byRootTaskId };
        delete next[rootTaskId];
        return { byRootTaskId: next, lastError: { ...s.lastError, [rootTaskId]: null } };
      });
      return true;
    }
    set((s) => ({ lastError: { ...s.lastError, [rootTaskId]: res.error?.message ?? 'discard failed' } }));
    return false;
  },

  refine: async (rootTaskId, feedback) => {
    set((s) => ({ refining: { ...s.refining, [rootTaskId]: true } }));
    const res = await api().refinePlanTree(rootTaskId, feedback);
    if (res.ok) {
      set((s) => ({ lastError: { ...s.lastError, [rootTaskId]: null } }));
      return true;
    }
    set((s) => ({
      refining: { ...s.refining, [rootTaskId]: false },
      lastError: { ...s.lastError, [rootTaskId]: res.error?.message ?? 'refine failed' },
    }));
    return false;
  },

  clearBanner: () => set({ readyBanner: null }),

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });
    if (unsubscribe) unsubscribe();
    unsubscribe = subscribeToEvents({
      'plan-tree:ready': (e) => {
        set({ readyBanner: { rootTaskId: e.rootTaskId, nodeCount: e.nodeCount, maxDepth: e.maxDepth } });
        void get().loadPlanTree(e.rootTaskId);
      },
      'plan-tree:discarded': (e) => {
        set((s) => {
          const nextByRoot = { ...s.byRootTaskId };
          delete nextByRoot[e.rootTaskId];
          const banner = s.readyBanner && s.readyBanner.rootTaskId === e.rootTaskId ? null : s.readyBanner;
          return {
            byRootTaskId: nextByRoot,
            refining: { ...s.refining, [e.rootTaskId]: false },
            readyBanner: banner,
          };
        });
      },
    });
  },
}));
