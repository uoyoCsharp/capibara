import { X, Trash, Play } from '@phosphor-icons/react';
import type { TaskRecord, TaskStatus, RoleRecord } from '@shared/contracts';
import { clsx } from 'clsx';

interface TaskDetailDrawerProps {
  task: TaskRecord;
  roles: RoleRecord[];
  onClose: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onStartRun?: (taskId: string, roleId: string) => void;
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
}: TaskDetailDrawerProps) {
  const assignee = task.assigneeRoleId
    ? roles.find((r) => r.id === task.assigneeRoleId)
    : null;

  return (
    <div className="w-96 border-l border-gray-200 bg-white h-full overflow-auto flex flex-col">
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
      <div className="flex-1 px-5 py-4 space-y-5">
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

        {/* Depth */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Depth
          </label>
          <span className="text-sm text-gray-600">{task.depth}</span>
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
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Play size={16} weight="fill" />
            Execute
          </button>
        )}
      </div>
    </div>
  );
}
