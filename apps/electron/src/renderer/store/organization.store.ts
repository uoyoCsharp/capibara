import { create } from 'zustand';
import type { OrganizationRecord, RoleRecord, SkillRecord } from '@core/shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface OrganizationState {
  roles: RoleRecord[];
  skills: SkillRecord[];
  isLoadingRoles: boolean;
  isLoadingSkills: boolean;

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
}

export const useOrganizationStore = create<OrganizationState>((set, get) => ({
  roles: [],
  skills: [],
  isLoadingRoles: false,
  isLoadingSkills: false,

  loadRoles: async (orgId) => {
    set({ isLoadingRoles: true });
    const result = await api().getRolesByOrgId(orgId);
    if (result.ok) {
      set({ roles: result.data as RoleRecord[], isLoadingRoles: false });
    } else {
      set({ isLoadingRoles: false });
    }
  },

  createRole: async (input) => {
    const result = await api().createRole(input);
    if (result.ok) return result.data as RoleRecord;
    return null;
  },

  updateRole: async (input) => {
    const result = await api().updateRole(input);
    if (result.ok) return result.data as RoleRecord;
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
      set({ skills: result.data as SkillRecord[], isLoadingSkills: false });
    } else {
      set({ isLoadingSkills: false });
    }
  },

  createSkill: async (input) => {
    const result = await api().createSkill(input);
    if (result.ok) {
      await get().loadSkills();
      return result.data as SkillRecord;
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
    if (result.ok) return result.data as OrganizationRecord;
    return null;
  },

  deleteOrganization: async (id) => {
    const result = await api().deleteOrganization(id);
    return result.ok;
  },

  loadTemplate: async (templateId, orgName, workspacePath) => {
    const result = await api().loadTemplate(templateId, orgName, workspacePath);
    if (result.ok) return result.data as OrganizationRecord;
    return null;
  },
}));
