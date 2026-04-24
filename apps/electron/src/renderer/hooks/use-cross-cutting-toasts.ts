import { useEffect } from 'react';
import type { SectionId } from '@core/shared/types';
import { subscribeToEvents } from '../lib/subscribe-to-events';
import { toast } from '../store/toast.store';
import { useT } from './use-locale';

/**
 * App-wide toasts triggered by backend events that aren't scoped to a single
 * store. Currently: run completion status + conversation response-needed.
 *
 * Store-scoped events (e.g. run:log, task:entered-approval) belong in the
 * corresponding store's init(); this hook only handles cross-cutting UX.
 */
export function useCrossCuttingToasts(
  activeSection: SectionId,
  onNavigate: (section: SectionId) => void,
) {
  const t = useT();

  useEffect(() => {
    const unsub = subscribeToEvents({
      'run:completed': (event) => {
        if (event.status === 'succeeded') {
          toast.success(`${t.runs?.completed ?? 'Run completed'} — ${event.tokenCount} tokens`);
        } else if (event.status === 'failed') {
          toast.error(t.runs?.failed ?? 'Run failed');
        } else if (event.status === 'cancelled') {
          toast.info(t.runs?.cancelled ?? 'Run cancelled');
        }
      },
      'conversation:response-needed': () => {
        if (activeSection !== 'inbox') {
          toast.info(t.conversations?.humanReplyNotification ?? 'Conversation needs response', {
            duration: 5000,
            action: {
              label: t.conversations?.goToConversations ?? 'View',
              onClick: () => onNavigate('inbox'),
            },
          });
        }
      },
    });
    return unsub;
  }, [t, activeSection, onNavigate]);
}
