import { create } from 'zustand';
import type { TaskRecord, RoleRecord } from '@core/shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface TaskState {
  tasks: TaskRecord[];
  roles: RoleRecord[];
  currentOrgId: string | null;
  selectedTaskId: string | null;
  isLoading: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  loadTasks: (orgId: string) => Promise<void>;
  loadRoles: (orgId: string) => Promise<void>;
  createTask: (input: unknown) => Promise<TaskRecord | null>;
  updateTaskStatus: (taskId: string, status: string) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  roles: [],
  currentOrgId: null,
  selectedTaskId: null,
  isLoading: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  loadTasks: async (orgId) => {
    set({ isLoading: true });
    const result = await api().getTasksByOrgId(orgId);
    if (result.ok) {
      set({ tasks: result.data as TaskRecord[], isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  loadRoles: async (orgId) => {
    const result = await api().getRolesByOrgId(orgId);
    if (result.ok) set({ roles: result.data as RoleRecord[] });
  },

  createTask: async (input) => {
    const result = await api().createTask(input);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) await get().loadTasks(currentOrgId);
      return result.data as TaskRecord;
    }
    return null;
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
}));
