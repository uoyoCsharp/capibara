import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  ArrowsClockwise,
  ChatCircleDots,
  Lightning,
  ShieldWarning,
  Clock,
  FunnelSimple,
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useT } from '../../hooks/useLocale';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { RunRecord, TaskRecord, RoleRecord } from '@shared/contracts';
import { useWorkflowSchema } from '../../hooks/useWorkflowSchema';

declare const window: Window & { capibara: import('@shared/contracts').CapibaraApi };

interface ActivityTimelineProps {
  orgId: string;
  roles: RoleRecord[];
  tasks: TaskRecord[];
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'run_succeeded' | 'run_failed' | 'task_completed' | 'task_status' | 'escalation';
  title: string;
  description: string;
  roleId?: string;
  taskId?: string;
}

const PAGE_SIZE = 20;

export function ActivityTimeline({ orgId, roles, tasks }: ActivityTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const t = useT();
  const schemaHelpers = useWorkflowSchema(orgId);

  const roleName = useCallback(
    (id: string) => roles.find((r) => r.id === id)?.name ?? t.common.unknown,
    [roles, t.common.unknown],
  );

  const taskTitle = useCallback(
    (id: string) => tasks.find((t) => t.id === id)?.title ?? 'Unknown task',
    [tasks],
  );

  const buildEvents = useCallback(async () => {
    setLoading(true);
    try {
      let runsRes;
      try {
        runsRes = await window.capibara.getRunsByOrgId(orgId);
      } catch { return; }
      if (!runsRes.ok) return;

      const runs = runsRes.data as RunRecord[];
      const timelineEvents: TimelineEvent[] = [];

      // Run events
      for (const run of runs) {
        if (run.status === 'succeeded') {
          timelineEvents.push({
            id: `run-ok-${run.id}`,
            timestamp: run.finishedAt ?? run.createdAt,
            type: 'run_succeeded',
            title: t.activity.runSucceeded,
            description: `${roleName(run.roleId)} completed work on "${taskTitle(run.taskNodeId ?? '')}"`,
            roleId: run.roleId,
            taskId: run.taskNodeId ?? undefined,
          });
        } else if (run.status === 'failed') {
          timelineEvents.push({
            id: `run-fail-${run.id}`,
            timestamp: run.finishedAt ?? run.createdAt,
            type: 'run_failed',
            title: t.activity.runFailed,
            description: `${roleName(run.roleId)} failed on "${taskTitle(run.taskNodeId ?? '')}"`,
            roleId: run.roleId,
            taskId: run.taskNodeId ?? undefined,
          });
        }
      }

      // Task completion events
      for (const task of tasks) {
        if (schemaHelpers.isTerminalStatus(task.status)) {
          timelineEvents.push({
            id: `task-done-${task.id}`,
            timestamp: task.updatedAt,
            type: 'task_completed',
            title: `${t.activity.taskStatus} ${t.task[task.status as keyof typeof t.task] ?? task.status}`,
            description: `"${task.title}" was marked as ${task.status}`,
            taskId: task.id,
          });
        } else if (task.status === 'blocked') {
          // Convention: 'blocked' status is shown as escalation
          timelineEvents.push({
            id: `task-blocked-${task.id}`,
            timestamp: task.updatedAt,
            type: 'escalation',
            title: t.activity.taskBlocked,
            description: `"${task.title}" is blocked`,
            taskId: task.id,
          });
        }
      }

      // Sort by timestamp descending
      timelineEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setEvents(timelineEvents);
    } finally {
      setLoading(false);
    }
  }, [orgId, roles, tasks, roleName, taskTitle, schemaHelpers]);

  useEffect(() => {
    buildEvents();
  }, [buildEvents]);

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => e.type === filter);

  const visible = filtered.slice(0, visibleCount);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-primary" />
            <CardTitle className="text-lg font-medium">{t.activity.title}</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {filtered.length} events
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <FunnelSimple size={14} className="text-muted-foreground" />
            <Select
              value={filter}
              onValueChange={(value) => { setFilter(value); setVisibleCount(PAGE_SIZE); }}
            >
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.activity.allEvents}</SelectItem>
                <SelectItem value="run_succeeded">{t.activity.runsSucceeded}</SelectItem>
                <SelectItem value="run_failed">{t.activity.runsFailed}</SelectItem>
                <SelectItem value="task_completed">{t.activity.tasksCompleted}</SelectItem>
                <SelectItem value="escalation">{t.activity.escalations}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.activity.loadingActivity}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.activity.noActivity}</p>
        ) : (
          <div className="space-y-0">
            {visible.map((event, idx) => (
              <TimelineItem
                key={event.id}
                event={event}
                isLast={idx === visible.length - 1}
              />
            ))}
          </div>
        )}

        {visibleCount < filtered.length && (
          <Button
            variant="link"
            size="sm"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="mt-3 px-0"
          >
            {t.activity.showMore} ({filtered.length - visibleCount} remaining)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineItem({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const Icon = EVENT_ICONS[event.type];
  const color = EVENT_COLORS[event.type];

  return (
    <div className="flex gap-3">
      {/* Timeline line + icon */}
      <div className="flex flex-col items-center">
        <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', color.bg)}>
          <Icon size={14} className={color.icon} weight="bold" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border my-1" />}
      </div>

      {/* Content */}
      <div className="pb-5 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-foreground">{event.title}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(event.timestamp).toLocaleString()}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
      </div>
    </div>
  );
}

const EVENT_ICONS: Record<string, typeof CheckCircle> = {
  run_succeeded: CheckCircle,
  run_failed: XCircle,
  task_completed: CheckCircle,
  task_status: ArrowsClockwise,
  escalation: ShieldWarning,
};

const EVENT_COLORS: Record<string, { bg: string; icon: string }> = {
  run_succeeded: { bg: 'bg-green-500/10', icon: 'text-green-500' },
  run_failed: { bg: 'bg-destructive/10', icon: 'text-destructive' },
  task_completed: { bg: 'bg-green-500/10', icon: 'text-green-500' },
  task_status: { bg: 'bg-blue-500/10', icon: 'text-blue-500' },
  escalation: { bg: 'bg-yellow-500/10', icon: 'text-yellow-500' },
};
