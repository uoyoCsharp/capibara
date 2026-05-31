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
  devModeEnabled: boolean;
  devPanelOpen: boolean;

  setActiveSection: (section: SectionId) => void;
  setCurrentOrgId: (id: string | null) => void;
  setDevModeEnabled: (enabled: boolean) => void;
  toggleDevPanel: () => void;
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
  devModeEnabled: false,
  devPanelOpen: false,

  setActiveSection: (section) => set({ activeSection: section }),
  setCurrentOrgId: (id) => set({ currentOrgId: id }),

  setDevModeEnabled: (enabled) => {
    void api().setSetting('dev_mode_enabled', String(enabled));
    set({ devModeEnabled: enabled, ...(enabled ? {} : { devPanelOpen: false }) });
  },

  toggleDevPanel: () => set((state) => {
    if (!state.devModeEnabled) return state;
    return { devPanelOpen: !state.devPanelOpen };
  }),

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

    void api().getSetting('dev_mode_enabled').then((result) => {
      if (result.ok && result.data === 'true') {
        set({ devModeEnabled: true });
      }
    });

    if (appUnsubscribe) appUnsubscribe();
    appUnsubscribe = subscribeToEvents({
      'snapshot:updated': () => void get().loadOrganizations(),
      'org:changed': () => void get().loadOrganizations(),
    });
  },
}));
