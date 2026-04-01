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
import { clsx } from 'clsx';
import type { RunRecord, TaskRecord, RoleRecord } from '@shared/contracts';

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

  const roleName = useCallback(
    (id: string) => roles.find((r) => r.id === id)?.name ?? 'Unknown',
    [roles],
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
            title: `Run succeeded`,
            description: `${roleName(run.roleId)} completed work on "${taskTitle(run.taskNodeId)}"`,
            roleId: run.roleId,
            taskId: run.taskNodeId,
          });
        } else if (run.status === 'failed') {
          timelineEvents.push({
            id: `run-fail-${run.id}`,
            timestamp: run.finishedAt ?? run.createdAt,
            type: 'run_failed',
            title: `Run failed`,
            description: `${roleName(run.roleId)} failed on "${taskTitle(run.taskNodeId)}"`,
            roleId: run.roleId,
            taskId: run.taskNodeId,
          });
        }
      }

      // Task completion events
      for (const task of tasks) {
        if (task.status === 'done' || task.status === 'approved') {
          timelineEvents.push({
            id: `task-done-${task.id}`,
            timestamp: task.updatedAt,
            type: 'task_completed',
            title: `Task ${task.status}`,
            description: `"${task.title}" was marked as ${task.status}`,
            taskId: task.id,
          });
        } else if (task.status === 'blocked') {
          timelineEvents.push({
            id: `task-blocked-${task.id}`,
            timestamp: task.updatedAt,
            type: 'escalation',
            title: 'Task blocked',
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
  }, [orgId, roles, tasks, roleName, taskTitle]);

  useEffect(() => {
    buildEvents();
  }, [buildEvents]);

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => e.type === filter);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={20} className="text-indigo-500" />
          <h2 className="text-lg font-medium text-gray-800">Activity Timeline</h2>
          <span className="text-xs text-gray-400">({filtered.length} events)</span>
        </div>
        <div className="flex items-center gap-2">
          <FunnelSimple size={14} className="text-gray-400" />
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
            className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">All events</option>
            <option value="run_succeeded">Runs succeeded</option>
            <option value="run_failed">Runs failed</option>
            <option value="task_completed">Tasks completed</option>
            <option value="escalation">Escalations</option>
          </select>
        </div>
      </div>

      {loading && events.length === 0 ? (
        <p className="text-sm text-gray-400">Loading activity...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-400">No activity yet for this organization.</p>
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
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Show more ({filtered.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}

function TimelineItem({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const Icon = EVENT_ICONS[event.type];
  const color = EVENT_COLORS[event.type];

  return (
    <div className="flex gap-3">
      {/* Timeline line + icon */}
      <div className="flex flex-col items-center">
        <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center shrink-0', color.bg)}>
          <Icon size={14} className={color.icon} weight="bold" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-800">{event.title}</span>
          <span className="text-xs text-gray-400">
            {new Date(event.timestamp).toLocaleString()}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>
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
  run_succeeded: { bg: 'bg-green-100', icon: 'text-green-600' },
  run_failed: { bg: 'bg-red-100', icon: 'text-red-600' },
  task_completed: { bg: 'bg-emerald-100', icon: 'text-emerald-600' },
  task_status: { bg: 'bg-blue-100', icon: 'text-blue-600' },
  escalation: { bg: 'bg-amber-100', icon: 'text-amber-600' },
};
