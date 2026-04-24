import { useAppStore } from '../store/app.store';

/**
 * Thin wrapper around useAppStore for legacy callers. The store initializes
 * itself and subscribes to org:changed / snapshot:updated events in its
 * own init(). New components should read useAppStore directly.
 */
export function useAppSnapshot() {
  const organizations = useAppStore((s) => s.organizations);
  const currentOrgId = useAppStore((s) => s.currentOrgId);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadOrganizations = useAppStore((s) => s.loadOrganizations);

  return { organizations, currentOrgId, isLoading, refresh: loadOrganizations };
}
