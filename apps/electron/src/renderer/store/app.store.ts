import { create } from 'zustand';
import type { OrganizationRecord, SectionId } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';

const api = () => window.capibara;

interface AppState {
  activeSection: SectionId;
  organizations: OrganizationRecord[];
  currentOrgId: string | null;
  isLoading: boolean;
  isInitialized: boolean;

  setActiveSection: (section: SectionId) => void;
  setCurrentOrgId: (id: string | null) => void;
  loadOrganizations: () => Promise<void>;
  init: () => void;
}

let appUnsubscribe: (() => void) | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  activeSection: 'dashboard',
  organizations: [],
  currentOrgId: null,
  isLoading: true,
  isInitialized: false,

  setActiveSection: (section) => set({ activeSection: section }),
  setCurrentOrgId: (id) => set({ currentOrgId: id }),

  loadOrganizations: async () => {
    try {
      const result = await api().getOrganizations();
      if (result.ok) {
        const orgs = result.data;
        set((state) => {
          const stillValid = state.currentOrgId && orgs.some((o) => o.id === state.currentOrgId);
          return {
            organizations: orgs,
            currentOrgId: stillValid ? state.currentOrgId : (orgs[0]?.id ?? null),
            isLoading: false,
          };
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  init: () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    void get().loadOrganizations();

    if (appUnsubscribe) appUnsubscribe();
    appUnsubscribe = subscribeToEvents({
      'snapshot:updated': () => void get().loadOrganizations(),
      'org:changed': () => void get().loadOrganizations(),
    });
  },
}));
