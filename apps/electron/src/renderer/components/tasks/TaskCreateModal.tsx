import { useState, useEffect } from 'react';
import { X } from '@phosphor-icons/react';
import type { TaskType, RoleRecord, CreateTaskInput } from '@shared/contracts';

interface TaskCreateModalProps {
  orgId: string;
  parentId: string | null;
  parentType: TaskType | null;
  roles: RoleRecord[];
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
}

const TASK_TYPES: TaskType[] = ['epic', 'story', 'task', 'subtask', 'spike', 'bug', 'chore'];

const TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  epic: 'Large feature or initiative',
  story: 'User-facing requirement',
  task: 'Technical implementation work',
  subtask: 'Small piece of a larger task',
  spike: 'Research or investigation',
  bug: 'Defect fix',
  chore: 'Maintenance or housekeeping',
};

export function TaskCreateModal({
  orgId,
  parentId,
  parentType,
  roles,
  onClose,
  onSubmit,
}: TaskCreateModalProps) {
  const defaultType: TaskType = parentId ? 'task' : 'epic';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>(defaultType);
  const [assigneeRoleId, setAssigneeRoleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    onSubmit({
      orgId,
      parentId,
      type,
      title: title.trim(),
      description: description.trim(),
      assigneeRoleId,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {parentId ? 'Create Child Task' : 'Create New Task'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter task title..."
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
              autoFocus
            />
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)} — {TYPE_DESCRIPTIONS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              rows={4}
              placeholder="Describe the task..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Assignee Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assignee Role</label>
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={assigneeRoleId ?? ''}
              onChange={(e) => setAssigneeRoleId(e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
