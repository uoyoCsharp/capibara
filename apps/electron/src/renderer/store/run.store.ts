import { create } from 'zustand';
import type { RunRecord } from '@core/shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface RunState {
  runs: RunRecord[];
  currentOrgId: string | null;
  selectedRunId: string | null;
  isLoading: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedRunId: (id: string | null) => void;
  loadRuns: (orgId: string) => Promise<void>;
  cancelRun: (id: string) => Promise<boolean>;
  refreshRun: (id: string) => Promise<void>;
}

export const useRunStore = create<RunState>((set, get) => ({
  runs: [],
  currentOrgId: null,
  selectedRunId: null,
  isLoading: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedRunId: (id) => set({ selectedRunId: id }),

  loadRuns: async (orgId) => {
    set({ isLoading: true });
    const result = await api().getRunsByOrgId(orgId);
    if (result.ok) {
      set({ runs: result.data as RunRecord[], isLoading: false });
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
      const run = result.data as RunRecord;
      set((state) => ({
        runs: state.runs.map((r) => (r.id === id ? run : r)),
      }));
    }
  },
}));
