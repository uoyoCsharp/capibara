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
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-orange-100 text-orange-700',
  awaiting_review: 'bg-yellow-100 text-yellow-700',
  revision: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  done: 'bg-green-100 text-green-800',
  blocked: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
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
      } catch { /* IPC may fail */ }

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
    <div className="w-[28rem] border-l border-gray-200 bg-white h-full overflow-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h3 className="text-base font-semibold text-gray-900 truncate">Task Details</h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-4 space-y-5 overflow-auto">
        {/* Review banner */}
        {needsReview && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3">
            <p className="text-sm font-medium text-yellow-800 mb-1">Awaiting Your Review</p>
            <p className="text-xs text-yellow-700">
              This task was completed by {assignee?.name ?? 'an AI role'}. Review the output and discussion below, then approve or request revision.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => onStatusChange(task.id, 'approved')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                Approve
              </button>
              <button
                onClick={() => onStatusChange(task.id, 'revision')}
                className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600"
              >
                Request Revision
              </button>
            </div>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Title
          </label>
          <p className="text-sm text-gray-900 font-medium">{task.title}</p>
        </div>

        {/* Type + Status */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Type
            </label>
            <span className="text-sm font-medium text-gray-700 capitalize">
              {task.type}
            </span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Status
            </label>
            <select
              className={clsx(
                'rounded-md px-2 py-1 text-xs font-semibold border-0 focus:ring-2 focus:ring-indigo-500',
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
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Assignee
          </label>
          <span className="text-sm text-gray-600">
            {assignee ? assignee.name : 'Unassigned'}
          </span>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Description
          </label>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {task.description || 'No description'}
          </p>
        </div>

        {/* Artifacts */}
        {task.artifactPaths && task.artifactPaths.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Artifacts
            </label>
            <ul className="space-y-1">
              {task.artifactPaths.map((path, i) => (
                <li key={i} className="text-xs text-indigo-600 font-mono truncate">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Context tabs: Run Output + Discussion */}
        {(latestRun || messages.length > 0) && (
          <div>
            <div className="flex border-b border-gray-200 mb-3">
              {latestRun && (
                <button
                  onClick={() => setContextTab('output')}
                  className={clsx(
                    'flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                    contextTab === 'output'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700',
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
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700',
                  )}
                >
                  <ChatCircleDots size={12} />
                  Discussion ({messages.length})
                </button>
              )}
            </div>

            {contextTab === 'output' && latestRun && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                  <span className={clsx(
                    'rounded-full px-2 py-0.5 font-medium',
                    latestRun.status === 'succeeded' ? 'bg-green-100 text-green-700' :
                    latestRun.status === 'failed' ? 'bg-red-100 text-red-700' :
                    latestRun.status === 'running' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600',
                  )}>
                    {latestRun.status}
                  </span>
                  {latestRun.costUsd > 0 && (
                    <span className="text-green-600">${latestRun.costUsd.toFixed(4)}</span>
                  )}
                  <span>{new Date(latestRun.createdAt).toLocaleString()}</span>
                </div>
                {latestRun.outputLog ? (
                  <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed">
                    {latestRun.outputLog.slice(0, 8000)}
                    {latestRun.outputLog.length > 8000 && '\n... (truncated)'}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-400">No output log available.</p>
                )}
              </div>
            )}

            {contextTab === 'discussion' && messages.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-auto">
                {messages.map((msg) => (
                  <div key={msg.id} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700">
                        {msg.authorRoleId ? (roleNameMap.get(msg.authorRoleId) ?? 'Unknown') : msg.authorType}
                      </span>
                      {msg.voteTag && (
                        <span className={clsx(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          msg.voteTag === 'APPROVE' ? 'bg-green-100 text-green-700' :
                          msg.voteTag === 'REVISE' ? 'bg-orange-100 text-orange-700' :
                          msg.voteTag === 'CONCERN' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700',
                        )}>
                          {msg.voteTag}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400 ml-auto">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-4 text-xs text-gray-400">
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
      <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between">
        <button
          onClick={() => onDelete(task.id)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
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
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700',
            )}
          >
            <Play size={16} weight="fill" />
            {hasActiveRun ? 'Running...' : 'Execute'}
          </button>
        )}
      </div>
    </div>
  );
}
