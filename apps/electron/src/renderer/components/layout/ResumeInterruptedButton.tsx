import { useCallback, useEffect, useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useT } from '../../hooks/use-locale';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';

const api = () => window.capibara;

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

/**
 * Surfaces tasks left in 'interrupted' state by a prior app restart.
 * Hidden when there are none — recovery is opt-in to avoid re-running
 * non-idempotent CLI/LLM work without the user's awareness.
 */
export function ResumeInterruptedButton({
  collapsed,
  orgId,
}: {
  collapsed: boolean;
  orgId: string | null;
}) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setCount(0);
      return;
    }
    const res = await api().getInterruptedCount(orgId);
    if (res.ok) setCount(res.data.count);
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEventSubscription(
    ['run:changed', 'run:completed', 'task:changed'],
    useCallback(
      (event) => {
        if ('orgId' in event && event.orgId === orgId) void refresh();
      },
      [orgId, refresh],
    ),
  );

  const handleClick = useCallback(async () => {
    if (!orgId || loading) return;
    setLoading(true);
    try {
      const res = await api().resumeInterrupted(orgId);
      if (res.ok) {
        if (res.data.resumed > 0) {
          toast.success(
            format(t.executionControl?.resumeInterruptedToast ?? 'Resuming {n} interrupted task(s)', {
              n: res.data.resumed,
            }),
          );
        } else {
          toast.info(t.executionControl?.resumeInterruptedNoneToast ?? 'No interrupted tasks to resume');
        }
        void refresh();
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [orgId, loading, t, refresh]);

  if (count === 0) return null;

  const label =
    count > 1
      ? format(
          t.executionControl?.resumeInterruptedN ?? 'Resume interrupted ({n})',
          { n: count },
        )
      : (t.executionControl?.resumeInterrupted ?? 'Resume interrupted');

  const tooltip = format(
    t.executionControl?.resumeInterruptedTooltip ??
      '{n} task(s) were interrupted by a previous restart. Click to resume.',
    { n: count },
  );

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      title={tooltip}
      className={cn(
        'relative w-full text-xs border-orange-500/50 text-orange-600 dark:text-orange-400',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2',
      )}
    >
      <ArrowCounterClockwise size={16} className={cn('shrink-0', loading && 'animate-spin')} />
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && (
        <span className="absolute top-1 right-1 flex h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
      )}
    </Button>
  );
}
