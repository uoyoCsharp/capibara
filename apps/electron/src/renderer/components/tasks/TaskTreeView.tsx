import { useState } from 'react';
import { CaretRight, CaretDown, Plus, Trash, ListBullets } from '@phosphor-icons/react';
import type { TaskRecord, TaskStatus, TaskType } from '@shared/contracts';
import { clsx } from 'clsx';

interface TaskTreeViewProps {
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onAddTask: (parentId: string | null) => void;
  onDeleteTask: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  roleNames: Map<string, string>;
}

interface TreeNode {
  task: TaskRecord;
  children: TreeNode[];
}

function buildTree(tasks: TaskRecord[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const task of tasks) {
    map.set(task.id, { task, children: [] });
  }

  for (const task of tasks) {
    const node = map.get(task.id)!;
    if (task.parentId && map.has(task.parentId)) {
      map.get(task.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-gray-300',
  in_progress: 'bg-orange-400',
  awaiting_review: 'bg-yellow-400',
  revision: 'bg-orange-500',
  approved: 'bg-green-400',
  done: 'bg-green-500',
  blocked: 'bg-red-400',
  cancelled: 'bg-gray-400',
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

const TYPE_BADGE_COLORS: Record<TaskType, string> = {
  epic: 'bg-purple-100 text-purple-700',
  story: 'bg-blue-100 text-blue-700',
  task: 'bg-indigo-100 text-indigo-700',
  subtask: 'bg-slate-100 text-slate-600',
  spike: 'bg-amber-100 text-amber-700',
  bug: 'bg-red-100 text-red-700',
  chore: 'bg-gray-100 text-gray-600',
};

function TaskNodeItem({
  node,
  depth,
  selectedTaskId,
  onSelectTask,
  onAddTask,
  onDeleteTask,
  onStatusChange,
  roleNames,
}: {
  node: TreeNode;
  depth: number;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onAddTask: (parentId: string) => void;
  onDeleteTask: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  roleNames: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.task.id;
  const assigneeName = node.task.assigneeRoleId
    ? roleNames.get(node.task.assigneeRoleId) ?? 'Unknown'
    : null;

  return (
    <div>
      <div
        className={clsx(
          'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
          isSelected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50',
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => onSelectTask(node.task.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className="shrink-0 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {hasChildren ? (
            expanded ? <CaretDown size={14} /> : <CaretRight size={14} />
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Status indicator */}
        <span
          className={clsx(
            'w-2.5 h-2.5 rounded-full shrink-0',
            STATUS_COLORS[node.task.status],
          )}
          title={STATUS_LABELS[node.task.status]}
        />

        {/* Type badge */}
        <span
          className={clsx(
            'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0',
            TYPE_BADGE_COLORS[node.task.type],
          )}
        >
          {node.task.type}
        </span>

        {/* Title */}
        <span
          className={clsx(
            'text-sm font-medium truncate flex-1',
            isSelected ? 'text-indigo-700' : 'text-gray-800',
            node.task.status === 'cancelled' && 'line-through text-gray-400',
          )}
        >
          {node.task.title}
        </span>

        {/* Assignee */}
        {assigneeName && (
          <span className="text-xs text-gray-400 shrink-0 truncate max-w-30">
            {assigneeName}
          </span>
        )}

        {/* Actions (visible on hover) */}
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
            title="Add child task"
            onClick={(e) => {
              e.stopPropagation();
              onAddTask(node.task.id);
            }}
          >
            <Plus size={14} />
          </button>
          <button
            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
            title="Delete task"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTask(node.task.id);
            }}
          >
            <Trash size={14} />
          </button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TaskNodeItem
              key={child.task.id}
              node={child}
              depth={depth + 1}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              onAddTask={onAddTask}
              onDeleteTask={onDeleteTask}
              onStatusChange={onStatusChange}
              roleNames={roleNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskTreeView({
  tasks,
  selectedTaskId,
  onSelectTask,
  onAddTask,
  onDeleteTask,
  onStatusChange,
  roleNames,
}: TaskTreeViewProps) {
  const tree = buildTree(tasks);

  if (tree.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <ListBullets size={40} className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm text-gray-400 mb-4">
          No tasks yet. Create an epic to get started.
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          onClick={() => onAddTask(null)}
        >
          <Plus size={16} />
          Create Epic
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <TaskNodeItem
          key={node.task.id}
          node={node}
          depth={0}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onAddTask={onAddTask}
          onDeleteTask={onDeleteTask}
          onStatusChange={onStatusChange}
          roleNames={roleNames}
        />
      ))}
    </div>
  );
}
