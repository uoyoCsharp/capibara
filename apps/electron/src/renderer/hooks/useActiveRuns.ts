import { useEffect, useState, useCallback, useRef } from 'react';
import type { RunRecord, DesktopEvent } from '@shared/contracts';

interface ActiveRunsState {
  runs: RunRecord[];
  count: number;
  isLoading: boolean;
}

/**
 * Global hook that tracks all active (queued/running) runs across all orgs.
 * Subscribes to run:changed events to stay in sync.
 */
export function useActiveRuns(): ActiveRunsState {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const orgsRef = useRef<string[]>([]);

  const loadActiveRuns = useCallback(async () => {
    try {
      const orgResult = await window.capibara.getOrganizations();
      if (!orgResult.ok) return;

      const orgIds = orgResult.data.map((o) => o.id);
      orgsRef.current = orgIds;

      const allRuns: RunRecord[] = [];
      for (const orgId of orgIds) {
        const runResult = await window.capibara.getRunsByOrgId(orgId);
        if (runResult.ok) {
          allRuns.push(
            ...runResult.data.filter(
              (r) => r.status === 'queued' || r.status === 'running',
            ),
          );
        }
      }
      setRuns(allRuns);
    } catch {
      // Silently fail — this is background state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActiveRuns();
  }, [loadActiveRuns]);

  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (event.type === 'run:changed' || event.type === 'run:completed') {
        void loadActiveRuns();
      }
    });
    return unsub;
  }, [loadActiveRuns]);

  return {
    runs,
    count: runs.length,
    isLoading,
  };
}
