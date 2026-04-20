import { useEffect } from 'react';
import type { DesktopEvent } from '@core/shared/types';

export function useEventSubscription(
  eventTypes: DesktopEvent['type'][],
  handler: (event: DesktopEvent) => void,
): void {
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsubscribe = window.capibara.subscribe((event) => {
      const typed = event as DesktopEvent;
      if (eventTypes.includes(typed.type)) {
        handler(typed);
      }
    });

    return unsubscribe;
  }, [eventTypes, handler]);
}
