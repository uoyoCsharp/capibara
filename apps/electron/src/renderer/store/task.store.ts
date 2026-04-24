import { create } from 'zustand';
import type { TaskRecord, RoleRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface TaskState {
  tasks: TaskRecord[];
  roles: RoleRecord[];
  currentOrgId: string | null;
  selectedTaskId: string | null;
  isLoading: boolean;
  isInitialized: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  loadTasks: (orgId: string) => Promise<void>;
  loadRoles: (orgId: string) => Promise<void>;
  createTask: (input: unknown) => Promise<TaskRecord | null>;
  updateTaskStatus: (taskId: string, status: string) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  init: () => void;
}

let taskUnsubscribe: (() => void) | null = null;

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  roles: [],
  currentOrgId: null,
  selectedTaskId: null,
  isLoading: false,
  isInitialized: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  loadTasks: async (orgId) => {
    set({ isLoading: true });
    const result = await api().getTasksByOrgId(orgId);
    if (result.ok) {
      set({ tasks: result.data, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  loadRoles: async (orgId) => {
    const result = await api().getRolesByOrgId(orgId);
    if (result.ok) set({ roles: result.data });
  },

  createTask: async (input) => {
    try {
      const result = await api().createTask(input);
      if (result.ok) {
        const { currentOrgId } = get();
        if (currentOrgId) await get().loadTasks(currentOrgId);
        return result.data;
      }
      console.error('[task.store] createTask failed:', result.error);
      return null;
    } catch (e) {
      console.error('[task.store] createTask exception:', e);
      return null;
    }
  },

  updateTaskStatus: async (taskId, status) => {
    const result = await api().updateTaskStatus(taskId, status);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) await get().loadTasks(currentOrgId);
      return true;
    }
    return false;
  },

  deleteTask: async (id) => {
    const result = await api().deleteTask(id);
    if (result.ok) {
      const { currentOrgId, selectedTaskId } = get();
      if (selectedTaskId === id) set({ selectedTaskId: null });
      if (currentOrgId) await get().loadTasks(currentOrgId);
      return true;
    }
    return false;
  },

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    if (taskUnsubscribe) taskUnsubscribe();
    taskUnsubscribe = subscribeToEvents({
      'task:changed': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) void get().loadTasks(currentOrgId);
      },
      'task:entered-approval': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) void get().loadTasks(currentOrgId);
      },
    });
  },
}));
