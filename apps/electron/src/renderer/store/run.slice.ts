import { create } from 'zustand';
import type {
  RunRecord,
  RunStatus,
  StartRunInput,
  RoleRecord,
  TaskRecord,
} from '@shared/contracts';

interface RunState {
  runs: RunRecord[];
  roles: RoleRecord[];
  tasks: TaskRecord[];
  currentOrgId: string | null;
  selectedRunId: string | null;
  isLoading: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedRunId: (id: string | null) => void;
  loadRuns: (orgId: string) => Promise<void>;
  loadRoles: (orgId: string) => Promise<void>;
  loadTasks: (orgId: string) => Promise<void>;
  startRun: (input: StartRunInput) => Promise<RunRecord | null>;
  cancelRun: (id: string) => Promise<boolean>;
  refreshRun: (id: string) => Promise<void>;
}

export const useRunStore = create<RunState>((set, get) => ({
  runs: [],
  roles: [],
  tasks: [],
  currentOrgId: null,
  selectedRunId: null,
  isLoading: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedRunId: (id) => set({ selectedRunId: id }),

  loadRuns: async (orgId: string) => {
    set({ isLoading: true });
    const result = await window.capibara.getRunsByOrgId(orgId);
    if (result.ok) {
      set({ runs: result.data, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  loadRoles: async (orgId: string) => {
    const result = await window.capibara.getRolesByOrgId(orgId);
    if (result.ok) {
      set({ roles: result.data });
    }
  },

  loadTasks: async (orgId: string) => {
    const result = await window.capibara.getTasksByOrgId(orgId);
    if (result.ok) {
      set({ tasks: result.data });
    }
  },

  startRun: async (input: StartRunInput) => {
    const result = await window.capibara.startRun(input);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) {
        await get().loadRuns(currentOrgId);
      }
      return result.data;
    }
    return null;
  },

  cancelRun: async (id: string) => {
    const result = await window.capibara.cancelRun(id);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) {
        await get().loadRuns(currentOrgId);
      }
      return true;
    }
    return false;
  },

  refreshRun: async (id: string) => {
    const result = await window.capibara.getRun(id);
    if (result.ok && result.data) {
      set((state) => ({
        runs: state.runs.map((r) => (r.id === id ? result.data! : r)),
      }));
    }
  },
}));
