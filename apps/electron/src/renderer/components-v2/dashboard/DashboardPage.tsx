import { useEffect, useCallback } from 'react';
import { SquaresFour, ListChecks, UsersThree, ChatCircleDots, CurrencyDollar } from '@phosphor-icons/react';
import { useTaskStore } from '../../store-v2/task.store';
import { useRunStore } from '../../store-v2/run.store';
import { useConversationStore } from '../../store-v2/conversation.store';
import { useOrganizationStore } from '../../store-v2/organization.store';
import { useEventSubscription } from '../../hooks-v2/use-event-subscription';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface DashboardPageProps {
  orgId: string | null;
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="p-[var(--card-padding)] rounded-xl border border-border space-y-2">
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function DashboardPage({ orgId }: DashboardPageProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const runs = useRunStore((s) => s.runs);
  const loadRuns = useRunStore((s) => s.loadRuns);
  const activeConversations = useConversationStore((s) => s.activeConversations);
  const loadActive = useConversationStore((s) => s.loadActiveConversations);
  const roles = useOrganizationStore((s) => s.roles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);

  useEffect(() => {
    if (orgId) {
      void loadTasks(orgId);
      void loadRuns(orgId);
      void loadActive(orgId);
      void loadRoles(orgId);
    }
  }, [orgId, loadTasks, loadRuns, loadActive, loadRoles]);

  useEventSubscription(['task:changed', 'run:changed', 'conversation:changed'], useCallback(() => {
    if (orgId) {
      void loadTasks(orgId);
      void loadRuns(orgId);
      void loadActive(orgId);
    }
  }, [orgId, loadTasks, loadRuns, loadActive]));

  const activeTasks = tasks.filter((t) => !['done', 'cancelled'].includes(t.status));
  const activeRuns = runs.filter((r) => ['queued', 'running'].includes(r.status));

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <SquaresFour size={48} weight="duotone" />
        <p>Select an organization to view dashboard</p>
      </div>
    );
  }

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)]">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <SquaresFour size={28} weight="duotone" />
          Dashboard
        </h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<ListChecks size={20} weight="duotone" />} label="Active Tasks" value={activeTasks.length} color="text-blue-600" />
        <StatCard icon={<UsersThree size={20} weight="duotone" />} label="Roles" value={roles.filter((r) => !r.isSystemRole).length} color="text-purple-600" />
        <StatCard icon={<ChatCircleDots size={20} weight="duotone" />} label="Active Conversations" value={activeConversations.length} color="text-yellow-600" />
        <StatCard icon={<CurrencyDollar size={20} weight="duotone" />} label="Active Runs" value={activeRuns.length} color="text-green-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border p-[var(--card-padding)]">
          <h2 className="font-semibold mb-3">Recent Tasks</h2>
          {tasks.slice(0, 8).map((task) => (
            <div key={task.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="truncate flex-1">{task.title}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-2">{task.status}</span>
            </div>
          ))}
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet</p>}
        </div>

        <div className="rounded-xl border border-border p-[var(--card-padding)]">
          <h2 className="font-semibold mb-3">Recent Runs</h2>
          {runs.slice(0, 8).map((run) => (
            <div key={run.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="truncate flex-1">{run.wakeReason}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                run.status === 'succeeded' ? 'bg-green-500/10 text-green-600' :
                run.status === 'failed' ? 'bg-red-500/10 text-red-600' :
                'bg-muted text-muted-foreground'
              }`}>{run.status}</span>
            </div>
          ))}
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet</p>}
        </div>
      </div>
    </div>
  );
}
