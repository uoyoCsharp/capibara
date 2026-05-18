import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleNotch, Pause, Play, ShieldWarning } from '@phosphor-icons/react';
import type { RunRecord, TaskRecord } from '@core/shared/types';
import { useT } from '../../hooks/use-locale';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import { useWorkflowSchema } from '../../hooks/use-workflow-schema';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';

const api = () => window.capibara;

type SchedulerStatus = 'paused' | 'awaiting_review' | 'running' | 'idle';

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

/**
 * Pause/resume the AI scheduler globally and surface the *current* execution
 * state, not just the user's last click. State priority: paused > approval
 * pending > running > idle. Idle disables the button (nothing to pause).
 */
export function SchedulerControlButton({
  collapsed,
  orgId,
}: {
  collapsed: boolean;
  orgId: string | null;
}) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const [activeRunCount, setActiveRunCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const calledRef = useRef(false);
  const { isApprovalStatus } = useWorkflowSchema(orgId);

  // Bootstrap paused state once.
  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;
    void api()
      .getExecutionState()
      .then((res) => {
        if (res.ok) setPaused(res.data.paused);
      })
      .catch(() => {});
  }, []);

  // Listen for backend pause/resume so multi-window state stays in sync.
  useEventSubscription(
    ['scheduler:paused', 'scheduler:resumed'],
    useCallback((event) => {
      if (event.type === 'scheduler:paused') setPaused(true);
      if (event.type === 'scheduler:resumed') setPaused(false);
    }, []),
  );

  // Refetch run/task counts whenever the org changes or runs/tasks change.
  const refresh = useCallback(async () => {
    if (!orgId) {
      setActiveRunCount(0);
      setApprovalCount(0);
      return;
    }
    const [runsRes, tasksRes] = await Promise.all([
      api().getRunsByOrgId(orgId),
      api().getTasksByOrgId(orgId),
    ]);
    if (runsRes.ok && runsRes.data) {
      const active = (runsRes.data as RunRecord[]).filter(
        (r) => r.status === 'running' || r.status === 'queued',
      );
      setActiveRunCount(active.length);
    }
    if (tasksRes.ok && tasksRes.data) {
      const pending = (tasksRes.data as TaskRecord[]).filter((task) =>
        isApprovalStatus(task.status),
      );
      setApprovalCount(pending.length);
    }
  }, [orgId, isApprovalStatus]);

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

  const status: SchedulerStatus = useMemo(() => {
    if (paused) return 'paused';
    if (approvalCount > 0) return 'awaiting_review';
    if (activeRunCount > 0) return 'running';
    return 'idle';
  }, [paused, approvalCount, activeRunCount]);

  const handleToggle = useCallback(async () => {
    if (loading || status === 'idle') return;
    setLoading(true);
    try {
      if (paused) {
        const res = await api().resumeExecution();
        if (res.ok) {
          setPaused(false);
          toast.success(t.executionControl?.resumedToast ?? 'Scheduler resumed');
        }
      } else {
        const res = await api().pauseExecution();
        if (res.ok) {
          setPaused(true);
          toast.success(t.executionControl?.pausedToast ?? 'Scheduler paused');
        }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [paused, loading, status, t]);

  const label = (() => {
    switch (status) {
      case 'paused':
        return t.executionControl?.statusPaused ?? 'Paused';
      case 'awaiting_review':
        return approvalCount > 1
          ? format(t.executionControl?.statusAwaitingReviewN ?? 'Awaiting review ({n})', {
              n: approvalCount,
            })
          : (t.executionControl?.statusAwaitingReview ?? 'Awaiting review');
      case 'running':
        return t.executionControl?.statusRunning ?? 'Running';
      case 'idle':
        return t.executionControl?.statusIdle ?? 'Idle';
    }
  })();

  const tooltip = status === 'idle' ? (t.executionControl?.idleHint ?? 'No active tasks') : label;

  const variant = status === 'paused' || status === 'awaiting_review' ? 'outline' : 'ghost';

  const colorClass = (() => {
    switch (status) {
      case 'paused':
        return 'border-amber-500/50 text-amber-600 dark:text-amber-400';
      case 'awaiting_review':
        return 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400';
      case 'running':
        return 'text-blue-600 dark:text-blue-400';
      case 'idle':
        return 'text-muted-foreground';
    }
  })();

  const Icon = (() => {
    switch (status) {
      case 'paused':
        return <Play size={16} weight="fill" className="shrink-0" />;
      case 'awaiting_review':
        return <ShieldWarning size={16} weight="fill" className="shrink-0" />;
      case 'running':
        return <CircleNotch size={16} className="shrink-0 animate-spin" />;
      case 'idle':
        return <Pause size={16} className="shrink-0 opacity-60" />;
    }
  })();

  // Status badge dot (collapsed sidebar only).
  const dotClass = (() => {
    switch (status) {
      case 'paused':
        return 'bg-amber-500 animate-pulse';
      case 'awaiting_review':
        return 'bg-yellow-500 animate-pulse';
      case 'running':
        return 'bg-blue-500 animate-pulse';
      case 'idle':
        return null;
    }
  })();

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={handleToggle}
      disabled={loading || status === 'idle'}
      title={collapsed ? tooltip : undefined}
      className={cn(
        'relative w-full text-xs',
        collapsed ? 'justify-center px-0' : 'justify-start gap-2',
        colorClass,
      )}
    >
      {Icon}
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && dotClass && (
        <span
          className={cn(
            'absolute top-1 right-1 flex h-2 w-2 rounded-full',
            dotClass,
          )}
        />
      )}
    </Button>
  );
}
