import { create } from 'zustand';
import type {
  TaskRecord,
  TaskType,
  TaskStatus,
  RoleRecord,
  CreateTaskInput,
} from '@shared/contracts';

interface TaskState {
  tasks: TaskRecord[];
  roles: RoleRecord[];
  currentOrgId: string | null;
  isLoading: boolean;
  selectedTaskId: string | null;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  loadTasks: (orgId: string) => Promise<void>;
  loadRoles: (orgId: string) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<TaskRecord | null>;
  updateTaskStatus: (id: string, status: TaskStatus) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  roles: [],
  currentOrgId: null,
  isLoading: false,
  selectedTaskId: null,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  loadTasks: async (orgId: string) => {
    set({ isLoading: true });
    const result = await window.capibara.getTasksByOrgId(orgId);
    if (result.ok) {
      set({ tasks: result.data, isLoading: false });
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

  createTask: async (input: CreateTaskInput) => {
    const result = await window.capibara.createTask(input);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) {
        await get().loadTasks(currentOrgId);
      }
      return result.data;
    }
    return null;
  },

  updateTaskStatus: async (id: string, status: TaskStatus) => {
    const result = await window.capibara.updateTaskStatus({ id, status } as import('@shared/contracts').UpdateTaskStatusInput);
    if (result.ok) {
      const { currentOrgId } = get();
      if (currentOrgId) {
        await get().loadTasks(currentOrgId);
      }
      return true;
    }
    return false;
  },

  deleteTask: async (id: string) => {
    const result = await window.capibara.deleteTask(id);
    if (result.ok) {
      const { currentOrgId, selectedTaskId } = get();
      if (selectedTaskId === id) {
        set({ selectedTaskId: null });
      }
      if (currentOrgId) {
        await get().loadTasks(currentOrgId);
      }
      return true;
    }
    return false;
  },
}));
