import { create } from 'zustand';
import type { OrganizationRecord, SectionId } from '@core/shared/types';

interface AppState {
  activeSection: SectionId;
  organizations: OrganizationRecord[];
  currentOrgId: string | null;
  isLoading: boolean;

  setActiveSection: (section: SectionId) => void;
  setCurrentOrgId: (id: string | null) => void;
  loadOrganizations: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: 'dashboard',
  organizations: [],
  currentOrgId: null,
  isLoading: true,

  setActiveSection: (section) => set({ activeSection: section }),
  setCurrentOrgId: (id) => set({ currentOrgId: id }),

  loadOrganizations: async () => {
    try {
      const result = await window.capibara.getOrganizations();
      if (result.ok) {
        const orgs = result.data;
        set((state) => ({
          organizations: orgs,
          currentOrgId: state.currentOrgId ?? orgs[0]?.id ?? null,
          isLoading: false,
        }));
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
