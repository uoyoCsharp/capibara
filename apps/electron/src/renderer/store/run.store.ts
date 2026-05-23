import { create } from 'zustand';
import type { RunRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

export interface ToolCallEntry {
  toolCallId: string;
  title: string;
  status: string;
  kind: string | null;
  timestamp: number;
}

interface RunState {
  runs: RunRecord[];
  currentOrgId: string | null;
  selectedRunId: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  toolCalls: Map<string, ToolCallEntry[]>;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedRunId: (id: string | null) => void;
  loadRuns: (orgId: string) => Promise<void>;
  cancelRun: (id: string) => Promise<boolean>;
  refreshRun: (id: string) => Promise<void>;
  getToolCalls: (runId: string) => ToolCallEntry[];
  init: () => void;
}

let runUnsubscribe: (() => void) | null = null;

export const useRunStore = create<RunState>((set, get) => ({
  runs: [],
  currentOrgId: null,
  selectedRunId: null,
  isLoading: false,
  isInitialized: false,
  toolCalls: new Map(),

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

  getToolCalls: (runId) => {
    return get().toolCalls.get(runId) ?? [];
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
      'run:tool-call': (e) => {
        set((state) => {
          const map = new Map(state.toolCalls);
          const list = [...(map.get(e.runId) ?? [])];
          const existing = list.findIndex(tc => tc.toolCallId === e.toolCallId);
          if (existing >= 0) {
            list[existing] = { ...list[existing], status: e.status };
          } else {
            list.push({
              toolCallId: e.toolCallId,
              title: e.title,
              status: e.status,
              kind: e.kind,
              timestamp: Date.now(),
            });
          }
          map.set(e.runId, list);
          return { toolCalls: map };
        });
      },
      'run:suspended': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) {
          void get().refreshRun(e.runId);
        }
      },
      'run:resumed': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) {
          void get().refreshRun(e.runId);
        }
      },
    });
  },
}));
