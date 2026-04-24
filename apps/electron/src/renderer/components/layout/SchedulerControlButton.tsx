import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from '@phosphor-icons/react';
import { useT } from '../../hooks/use-locale';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';

const api = () => window.capibara;

/**
 * Pause/resume the AI scheduler globally. Backend emits scheduler:paused /
 * scheduler:resumed when state changes so the button stays in sync across
 * multiple windows or external triggers.
 */
export function SchedulerControlButton({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true;
      void api().getExecutionState().then((res) => {
        if (res.ok) setPaused(res.data.paused);
      }).catch(() => {});
    }

    if (typeof api()?.subscribe !== 'function') return;
    const unsub = api().subscribe((event) => {
      if (event.type === 'scheduler:paused') setPaused(true);
      if (event.type === 'scheduler:resumed') setPaused(false);
    });
    return unsub;
  }, []);

  const handleToggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (paused) {
        const res = await api().resumeExecution();
        if (res.ok) { setPaused(false); toast.success(t.executionControl?.resumedToast ?? 'Scheduler resumed'); }
      } else {
        const res = await api().pauseExecution();
        if (res.ok) { setPaused(true); toast.success(t.executionControl?.pausedToast ?? 'Scheduler paused'); }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [paused, loading, t]);

  const label = paused
    ? (t.executionControl?.resumeAll ?? 'Resume')
    : (t.executionControl?.pauseAll ?? 'Pause');

  return (
    <Button
      variant={paused ? 'outline' : 'ghost'}
      size="sm"
      onClick={handleToggle}
      disabled={loading}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full text-xs',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2',
        paused && 'border-amber-500/50 text-amber-600',
      )}
    >
      {paused ? <Play size={16} weight="fill" className="shrink-0" /> : <Pause size={16} className="shrink-0" />}
      {!collapsed && label}
      {collapsed && paused && <span className="absolute top-1 right-1 flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />}
    </Button>
  );
}
