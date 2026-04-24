import type { DesktopEvent } from '@core/shared/types';

type EventType = DesktopEvent['type'];
type EventOf<T extends EventType> = Extract<DesktopEvent, { type: T }>;

export type EventHandlers = {
  [K in EventType]?: (event: EventOf<K>) => void;
};

/**
 * Subscribe to a map of DesktopEvent handlers via window.capibara.subscribe.
 *
 * Used by Zustand stores in their `init()` method. Returns an unsubscribe
 * function that removes the single underlying listener the preload exposes.
 *
 * The renderer gets exactly one subscription per caller — unhandled event
 * types are filtered out before the dispatcher fires, so stores see only
 * the types they care about.
 */
export function subscribeToEvents(handlers: EventHandlers): () => void {
  if (typeof window.capibara?.subscribe !== 'function') {
    return () => undefined;
  }

  return window.capibara.subscribe((event) => {
    const handler = handlers[event.type] as ((e: DesktopEvent) => void) | undefined;
    if (handler) handler(event);
  });
}
