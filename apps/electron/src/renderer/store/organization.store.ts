import { create } from 'zustand';
import type { OrganizationRecord, RoleRecord, SkillRecord } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface OrganizationState {
  roles: RoleRecord[];
  skills: SkillRecord[];
  currentOrgId: string | null;
  isLoadingRoles: boolean;
  isLoadingSkills: boolean;
  isInitialized: boolean;

  setCurrentOrgId: (orgId: string | null) => void;
  loadRoles: (orgId: string) => Promise<void>;
  createRole: (input: unknown) => Promise<RoleRecord | null>;
  updateRole: (input: unknown) => Promise<RoleRecord | null>;
  deleteRole: (id: string, orgId: string) => Promise<boolean>;

  loadSkills: () => Promise<void>;
  createSkill: (input: unknown) => Promise<SkillRecord | null>;
  deleteSkill: (id: string) => Promise<boolean>;

  updateOrganization: (input: unknown) => Promise<OrganizationRecord | null>;
  deleteOrganization: (id: string) => Promise<boolean>;

  loadTemplate: (templateId: string, orgName: string, workspacePath: string) => Promise<OrganizationRecord | null>;

  init: () => void;
}

let organizationUnsubscribe: (() => void) | null = null;

export const useOrganizationStore = create<OrganizationState>((set, get) => ({
  roles: [],
  skills: [],
  currentOrgId: null,
  isLoadingRoles: false,
  isLoadingSkills: false,
  isInitialized: false,

  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),

  loadRoles: async (orgId) => {
    set({ isLoadingRoles: true });
    const result = await api().getRolesByOrgId(orgId);
    if (result.ok) {
      set({ roles: result.data, isLoadingRoles: false });
    } else {
      set({ isLoadingRoles: false });
    }
  },

  createRole: async (input) => {
    const result = await api().createRole(input);
    if (result.ok) return result.data;
    return null;
  },

  updateRole: async (input) => {
    const result = await api().updateRole(input);
    if (result.ok) return result.data;
    return null;
  },

  deleteRole: async (id, orgId) => {
    const result = await api().deleteRole(id);
    if (result.ok) {
      await get().loadRoles(orgId);
      return true;
    }
    return false;
  },

  loadSkills: async () => {
    set({ isLoadingSkills: true });
    const result = await api().getSkills();
    if (result.ok) {
      set({ skills: result.data, isLoadingSkills: false });
    } else {
      set({ isLoadingSkills: false });
    }
  },

  createSkill: async (input) => {
    const result = await api().createSkill(input);
    if (result.ok) {
      await get().loadSkills();
      return result.data;
    }
    return null;
  },

  deleteSkill: async (id) => {
    const result = await api().deleteSkill(id);
    if (result.ok) {
      await get().loadSkills();
      return true;
    }
    return false;
  },

  updateOrganization: async (input) => {
    const result = await api().updateOrganization(input);
    if (result.ok) return result.data;
    return null;
  },

  deleteOrganization: async (id) => {
    const result = await api().deleteOrganization(id);
    return result.ok;
  },

  loadTemplate: async (templateId, orgName, workspacePath) => {
    const result = await api().loadTemplate(templateId, orgName, workspacePath);
    if (result.ok) return result.data;
    return null;
  },

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    if (organizationUnsubscribe) organizationUnsubscribe();
    organizationUnsubscribe = subscribeToEvents({
      'role:changed': (e) => {
        const { currentOrgId } = get();
        if (currentOrgId && e.orgId === currentOrgId) void get().loadRoles(currentOrgId);
      },
      'skill:changed': () => {
        void get().loadSkills();
      },
    });
  },
}));
