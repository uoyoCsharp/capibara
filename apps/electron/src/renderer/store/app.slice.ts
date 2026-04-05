import { create } from 'zustand';
import type { AppSnapshot, OrganizationRecord, SectionId } from '@shared/contracts';

interface AppState {
  // Navigation
  activeSection: SectionId;
  setActiveSection: (section: SectionId) => void;

  // Snapshot data
  organizations: OrganizationRecord[];
  currentOrgId: string | null;
  isLoading: boolean;

  // Actions
  loadSnapshot: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: 'dashboard',
  setActiveSection: (section) => set({ activeSection: section }),

  organizations: [],
  currentOrgId: null,
  isLoading: true,

  loadSnapshot: async () => {
    try {
      const result = await window.capibara.loadSnapshot();
      if (result.ok) {
        set({
          organizations: result.data.organizations,
          currentOrgId: result.data.currentOrgId,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      // window.capibara may not be available yet in dev
      set({ isLoading: false });
    }
  },
}));
