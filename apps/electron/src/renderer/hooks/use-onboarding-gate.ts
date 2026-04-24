import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/app.store';

const api = () => window.capibara;

/**
 * Decides whether to render the OnboardingWizard ahead of the main app shell.
 *
 * Initial state (`show === null`) means "still checking"; callers should
 * render a spinner until a concrete boolean is available.
 *
 * First-time onboarding is flagged by the absence of `onboardingCompleted`
 * setting AND no organizations. Subsequent "create workspace" flows reuse
 * the wizard but skip the health check (handled by OnboardingWizard itself
 * via `isFirstTime`).
 */
export function useOnboardingGate() {
  const organizations = useAppStore((s) => s.organizations);
  const isLoading = useAppStore((s) => s.isLoading);
  const loadOrganizations = useAppStore((s) => s.loadOrganizations);

  const [show, setShow] = useState<boolean | null>(null);
  const [isFirstTime, setIsFirstTime] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (organizations.length > 0) {
      setShow(false);
      return;
    }
    void api().getSetting('onboardingCompleted').then((res) => {
      if (res.ok && res.data === 'true') {
        setShow(false);
      } else {
        setIsFirstTime(true);
        setShow(true);
      }
    }).catch(() => setShow(false));
  }, [isLoading, organizations.length]);

  const openForNewWorkspace = useCallback(() => {
    setIsFirstTime(false);
    setShow(true);
  }, []);

  const markComplete = useCallback(() => {
    setShow(false);
    void loadOrganizations();
  }, [loadOrganizations]);

  return { show, isFirstTime, openForNewWorkspace, markComplete };
}
