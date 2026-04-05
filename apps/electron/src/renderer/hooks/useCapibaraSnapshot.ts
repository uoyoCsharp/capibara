import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/app.slice';

export function useCapibaraSnapshot() {
  const loadSnapshot = useAppStore((s) => s.loadSnapshot);
  const organizations = useAppStore((s) => s.organizations);
  const currentOrgId = useAppStore((s) => s.currentOrgId);
  const isLoading = useAppStore((s) => s.isLoading);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      void loadSnapshot();
    }

    // Subscribe to real-time events if the bridge is available
    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsubscribe = window.capibara.subscribe((event) => {
      if (event.type === 'snapshot:updated' || event.type === 'org:changed') {
        void loadSnapshot();
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { organizations, currentOrgId, isLoading, refresh: loadSnapshot };
}
