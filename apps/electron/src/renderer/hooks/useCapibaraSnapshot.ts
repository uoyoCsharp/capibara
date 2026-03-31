import { useEffect, useCallback } from 'react';
import { useAppStore } from '../store/app.slice';

export function useCapibaraSnapshot() {
  const loadSnapshot = useAppStore((s) => s.loadSnapshot);
  const organizations = useAppStore((s) => s.organizations);
  const currentOrgId = useAppStore((s) => s.currentOrgId);
  const isLoading = useAppStore((s) => s.isLoading);

  useEffect(() => {
    void loadSnapshot();

    const unsubscribe = window.capibara.subscribe((event) => {
      if (event.type === 'snapshot:updated' || event.type === 'org:changed') {
        void loadSnapshot();
      }
    });

    return unsubscribe;
  }, [loadSnapshot]);

  return { organizations, currentOrgId, isLoading, refresh: loadSnapshot };
}
