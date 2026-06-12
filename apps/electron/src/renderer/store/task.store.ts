import { create } from 'zustand';
import type { TaskRecord, RoleRecord, TaskDependencyRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface TaskState {
  tasks: TaskRecord[];
  roles: RoleRecord[];
  dependencies: TaskDependencyRecord[];
  currentOrgId: string | null;
  selectedTaskId: string | null;
  isLoading: boolean;
  isInitialized: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  loadTasks: (orgId: string) => Promise<void>;
  loadRoles: (orgId: string) => Promise<void>;
  loadDependencies: (taskId: string) => Promise<void>;
  loadAllDependencies: (orgId: string) => Promise<void>;
  addDependency: (orgId: string, dependentTaskId: string, dependencyTaskId: string) => Promise<boolean>;
  removeDependency: (dependencyId: string) => Promise<boolean>;
  createTask: (input: unknown) => Promise<TaskRecord | null>;
  updateTaskStatus: (taskId: string, status: string) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  init: () => void;
}

let taskUnsubscribe: (() => void) | null = null;

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  roles: [],
  dependencies: [],
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

  loadDependencies: async (taskId) => {
    const result = await api().getTaskDependencies(taskId);
    if (result.ok) {
      const { dependencies } = get();
      const otherDeps = dependencies.filter((d) => d.dependentTaskId !== taskId);
      set({ dependencies: [...otherDeps, ...result.data] });
    }
  },

  loadAllDependencies: async (orgId) => {
    const result = await api().getTaskDependenciesByOrgId(orgId);
    if (result.ok) {
      set({ dependencies: result.data });
    }
  },

  addDependency: async (orgId, dependentTaskId, dependencyTaskId) => {
    try {
      const result = await api().addTaskDependency({
        orgId,
        dependentTaskId,
        dependencyTaskId,
      });
      if (result.ok) {
        const { dependencies } = get();
        set({ dependencies: [...dependencies, result.data] });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  removeDependency: async (dependencyId) => {
    try {
      const result = await api().removeTaskDependency(dependencyId);
      if (result.ok) {
        const { dependencies } = get();
        set({ dependencies: dependencies.filter((d) => d.id !== dependencyId) });
        return true;
      }
      return false;
    } catch {
      return false;
    }
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
      const { currentOrgId, selectedTaskId, dependencies } = get();
      if (selectedTaskId === id) set({ selectedTaskId: null });
      set({ dependencies: dependencies.filter(
        (d) => d.dependentTaskId !== id && d.dependencyTaskId !== id
      )});
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
