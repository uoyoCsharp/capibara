import { useEffect, useRef } from 'react';
import { useAppStore } from '../store-v2/app.store';

export function useAppSnapshot() {
  const loadOrganizations = useAppStore((s) => s.loadOrganizations);
  const organizations = useAppStore((s) => s.organizations);
  const currentOrgId = useAppStore((s) => s.currentOrgId);
  const isLoading = useAppStore((s) => s.isLoading);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      void loadOrganizations();
    }

    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsubscribe = window.capibara.subscribe((event) => {
      if (event.type === 'org:changed' || event.type === 'snapshot:updated') {
        void loadOrganizations();
      }
    });

    return unsubscribe;
  }, []);

  return { organizations, currentOrgId, isLoading, refresh: loadOrganizations };
}
