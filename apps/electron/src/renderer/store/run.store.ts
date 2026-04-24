import { create } from 'zustand';
import type { RunRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface RunState {
  runs: RunRecord[];
  currentOrgId: string | null;
  selectedRunId: string | null;
  isLoading: boolean;
  isInitialized: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedRunId: (id: string | null) => void;
  loadRuns: (orgId: string) => Promise<void>;
  cancelRun: (id: string) => Promise<boolean>;
  refreshRun: (id: string) => Promise<void>;
  init: () => void;
}

let runUnsubscribe: (() => void) | null = null;

export const useRunStore = create<RunState>((set, get) => ({
  runs: [],
  currentOrgId: null,
  selectedRunId: null,
  isLoading: false,
  isInitialized: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedRunId: (id) => set({ selectedRunId: id }),

  loadRuns: async (orgId) => {
    set({ isLoading: true });
    const result = await api().getRunsByOrgId(orgId);
    if (result.ok) {
      set({ runs: result.data, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  cancelRun: async (id) => {
    const result = await api().cancelRun(id);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) await get().loadRuns(currentOrgId);
      return true;
    }
    return false;
  },

  refreshRun: async (id) => {
    const result = await api().getRun(id);
    if (result.ok && result.data) {
      const run = result.data;
      set((state) => ({
        runs: state.runs.map((r) => (r.id === id ? run : r)),
      }));
    }
  },

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    if (runUnsubscribe) runUnsubscribe();
    runUnsubscribe = subscribeToEvents({
      'run:changed': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) void get().loadRuns(currentOrgId);
      },
      'run:completed': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) void get().loadRuns(currentOrgId);
      },
      'run:status': (e) => {
        void get().refreshRun(e.runId);
      },
    });
  },
}));
