import { useEffect, useState } from 'react';
import { X, Trash, Play, ChatCircleDots, Terminal } from '@phosphor-icons/react';
import type {
  TaskRecord,
  TaskStatus,
  RoleRecord,
  RunRecord,
  DiscussionMessageRecord,
} from '@shared/contracts';
import { clsx } from 'clsx';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { toast } from '../../store/toast.store';

interface TaskDetailDrawerProps {
  task: TaskRecord;
  roles: RoleRecord[];
  onClose: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onStartRun?: (taskId: string, roleId: string) => void;
  hasActiveRun?: boolean;
}

const STATUS_OPTIONS: TaskStatus[] = [
  'pending',
  'in_progress',
  'awaiting_review',
  'revision',
  'approved',
  'done',
  'blocked',
  'cancelled',
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-neutral-subtle text-neutral-text',
  in_progress: 'bg-warning-subtle text-warning-text',
  awaiting_review: 'bg-warning-subtle text-warning-text',
  revision: 'bg-warning-subtle text-warning-text',
  approved: 'bg-success-subtle text-success-text',
  done: 'bg-success-subtle text-success-text',
  blocked: 'bg-danger-subtle text-danger-text',
  cancelled: 'bg-neutral-subtle text-neutral-text',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  awaiting_review: 'Awaiting Review',
  revision: 'Revision',
  approved: 'Approved',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

export function TaskDetailDrawer({
  task,
  roles,
  onClose,
  onStatusChange,
  onDelete,
  onStartRun,
  hasActiveRun,
}: TaskDetailDrawerProps) {
  const assignee = task.assigneeRoleId
    ? roles.find((r) => r.id === task.assigneeRoleId)
    : null;

  const [latestRun, setLatestRun] = useState<RunRecord | null>(null);
  const [messages, setMessages] = useState<DiscussionMessageRecord[]>([]);
  const [contextTab, setContextTab] = useState<'output' | 'discussion'>('output');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Load run history and discussion for this task
  useEffect(() => {
    (async () => {
      try {
        const runRes = await window.capibara.getRunsByTaskId(task.id);
        if (runRes.ok && runRes.data.length > 0) {
          // Most recent run first
          const sorted = [...runRes.data].sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt),
          );
          setLatestRun(sorted[0]);
        } else {
          setLatestRun(null);
        }
      } catch { toast.error('Failed to load run history'); }

      try {
        const groupRes = await window.capibara.getDiscussionGroupByTaskNodeId(task.id);
        if (groupRes.ok && groupRes.data) {
          const msgRes = await window.capibara.getDiscussionMessages(groupRes.data.id);
          if (msgRes.ok) setMessages(msgRes.data);
        } else {
          setMessages([]);
        }
      } catch { setMessages([]); }
    })();
  }, [task.id]);

  const roleNameMap = new Map(roles.map((r) => [r.id, r.name]));
  const needsReview = task.status === 'awaiting_review';

  return (
    <div className="w-[var(--drawer-width)] border-l border-border-default bg-surface-card h-full overflow-auto flex flex-col shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <h3 className="text-base font-semibold text-text-primary font-[family-name:var(--font-display)] truncate">Task Details</h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-text-muted hover:bg-surface-sunken hover:text-text-secondary"
        >
          <X size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-5 space-y-6 overflow-auto">
        {/* Review banner */}
        {needsReview && (
          <div className="rounded-lg bg-warning-subtle border border-warning px-4 py-3">
            <p className="text-sm font-medium text-warning-text mb-1">Awaiting Your Review</p>
            <p className="text-xs text-warning-text/80">
              This task was completed by {assignee?.name ?? 'an AI role'}. Review the output and discussion below, then approve or request revision.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onStatusChange(task.id, 'approved')}
                className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-text-inverse hover:opacity-90"
              >
                Approve
              </button>
              <button
                onClick={() => onStatusChange(task.id, 'revision')}
                className="rounded-md bg-warning px-3 py-1.5 text-xs font-medium text-text-inverse hover:opacity-90"
              >
                Request Revision
              </button>
            </div>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
            Title
          </label>
          <p className="text-sm text-text-primary font-medium">{task.title}</p>
        </div>

        {/* Type + Status */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
              Type
            </label>
            <span className="text-sm font-medium text-text-secondary capitalize">
              {task.type}
            </span>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
              Status
            </label>
            <select
              className={clsx(
                'rounded-md px-2 py-1 text-xs font-semibold border-0 focus:ring-2 focus:ring-accent',
                STATUS_COLORS[task.status],
              )}
              value={task.status}
              onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
            Assignee
          </label>
          <span className="text-sm text-text-secondary">
            {assignee ? assignee.name : 'Unassigned'}
          </span>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
            Description
          </label>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">
            {task.description || 'No description'}
          </p>
        </div>

        {/* Artifacts */}
        {task.artifactPaths && task.artifactPaths.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
              Artifacts
            </label>
            <ul className="space-y-1">
              {task.artifactPaths.map((path, i) => (
                <li key={i} className="text-xs text-accent-text font-mono truncate">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Context tabs: Run Output + Discussion */}
        {(latestRun || messages.length > 0) && (
          <div>
            <div className="flex border-b border-border-default mb-3">
              {latestRun && (
                <button
                  onClick={() => setContextTab('output')}
                  className={clsx(
                    'flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                    contextTab === 'output'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary',
                  )}
                >
                  <Terminal size={12} />
                  Run Output
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={() => setContextTab('discussion')}
                  className={clsx(
                    'flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                    contextTab === 'discussion'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary',
                  )}
                >
                  <ChatCircleDots size={12} />
                  Discussion ({messages.length})
                </button>
              )}
            </div>

            {contextTab === 'output' && latestRun && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-xs text-text-tertiary">
                  <span className={clsx(
                    'rounded-full px-2 py-0.5 font-medium',
                    latestRun.status === 'succeeded' ? 'bg-success-subtle text-success-text' :
                    latestRun.status === 'failed' ? 'bg-danger-subtle text-danger-text' :
                    latestRun.status === 'running' ? 'bg-info-subtle text-info-text' :
                    'bg-neutral-subtle text-neutral-text',
                  )}>
                    {latestRun.status}
                  </span>
                  {latestRun.costUsd > 0 && (
                    <span className="text-success">${latestRun.costUsd.toFixed(4)}</span>
                  )}
                  <span>{new Date(latestRun.createdAt).toLocaleString()}</span>
                </div>
                {latestRun.outputLog ? (
                  <pre className="bg-surface-sunken text-text-primary rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed">
                    {latestRun.outputLog.slice(0, 8000)}
                    {latestRun.outputLog.length > 8000 && '\n... (truncated)'}
                  </pre>
                ) : (
                  <p className="text-xs text-text-muted">No output log available.</p>
                )}
              </div>
            )}

            {contextTab === 'discussion' && messages.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-auto">
                {messages.map((msg) => (
                  <div key={msg.id} className="rounded-lg bg-surface-sunken px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-text-secondary">
                        {msg.authorRoleId ? (roleNameMap.get(msg.authorRoleId) ?? 'Unknown') : msg.authorType}
                      </span>
                      {msg.voteTag && (
                        <span className={clsx(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          msg.voteTag === 'APPROVE' ? 'bg-success-subtle text-success-text' :
                          msg.voteTag === 'REVISE' ? 'bg-warning-subtle text-warning-text' :
                          msg.voteTag === 'CONCERN' ? 'bg-danger-subtle text-danger-text' :
                          'bg-info-subtle text-info-text',
                        )}>
                          {msg.voteTag}
                        </span>
                      )}
                      <span className="text-[10px] text-text-muted ml-auto">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4 text-xs text-text-muted">
          <div>
            <span className="block uppercase tracking-wide mb-0.5">Created</span>
            {new Date(task.createdAt).toLocaleDateString()}
          </div>
          <div>
            <span className="block uppercase tracking-wide mb-0.5">Updated</span>
            {new Date(task.updatedAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border-subtle px-5 py-4 flex items-center justify-between">
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-danger-subtle transition-colors"
        >
          <Trash size={16} />
          Delete Task
        </button>
        {onStartRun && task.assigneeRoleId && (
          <button
            onClick={() => onStartRun(task.id, task.assigneeRoleId!)}
            disabled={hasActiveRun}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              hasActiveRun
                ? 'bg-surface-sunken text-text-disabled cursor-not-allowed'
                : 'bg-accent text-text-inverse hover:bg-accent-hover',
            )}
          >
            <Play size={16} weight="fill" />
            {hasActiveRun ? 'Running...' : 'Execute'}
          </button>
        )}
      </div>
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Task?"
          message="This will permanently delete this task. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            onDelete(task.id);
            setShowDeleteConfirm(false);
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
