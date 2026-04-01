import { useState } from 'react';
import { CaretRight, CaretDown, Plus, Trash, ListBullets } from '@phosphor-icons/react';
import type { TaskRecord, TaskStatus, TaskType } from '@shared/contracts';
import { clsx } from 'clsx';
import { ConfirmDialog } from '../shared/ConfirmDialog';

interface TaskTreeViewProps {
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  pendingApprovalTaskIds?: Set<string>;
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
  pending: 'bg-neutral',
  in_progress: 'bg-warning',
  awaiting_review: 'bg-warning',
  revision: 'bg-warning',
  approved: 'bg-success',
  done: 'bg-success',
  blocked: 'bg-danger',
  cancelled: 'bg-neutral',
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
  task: 'bg-accent-subtle text-accent-text',
  subtask: 'bg-neutral-subtle text-neutral-text',
  spike: 'bg-warning-subtle text-warning-text',
  bug: 'bg-danger-subtle text-danger-text',
  chore: 'bg-neutral-subtle text-neutral-text',
};

function hasDescendantApproval(node: TreeNode, ids?: Set<string>): boolean {
  if (!ids) return false;
  for (const child of node.children) {
    if (ids.has(child.task.id) || hasDescendantApproval(child, ids)) return true;
  }
  return false;
}

function TaskNodeItem({
  node,
  depth,
  selectedTaskId,
  pendingApprovalTaskIds,
  onSelectTask,
  onAddTask,
  onRequestDelete,
  onStatusChange,
  roleNames,
}: {
  node: TreeNode;
  depth: number;
  selectedTaskId: string | null;
  pendingApprovalTaskIds?: Set<string>;
  onSelectTask: (id: string) => void;
  onAddTask: (parentId: string) => void;
  onRequestDelete: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  roleNames: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.task.id;
  const assigneeName = node.task.assigneeRoleId
    ? roleNames.get(node.task.assigneeRoleId) ?? 'Unknown'
    : null;
  const hasApprovalPending = pendingApprovalTaskIds?.has(node.task.id) ||
    hasDescendantApproval(node, pendingApprovalTaskIds);

  return (
    <div>
      <div
        className={clsx(
          'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
          isSelected ? 'bg-accent-subtle ring-1 ring-[var(--accent-ring)]' : 'hover:bg-surface-sunken',
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => onSelectTask(node.task.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className="shrink-0 w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-secondary"
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
            isSelected ? 'text-accent-text' : 'text-text-primary',
            node.task.status === 'cancelled' && 'line-through text-text-disabled',
          )}
        >
          {node.task.title}
        </span>

        {/* Approval notification badge (red dot) */}
        {hasApprovalPending && (
          <span
            className="w-2.5 h-2.5 rounded-full bg-danger shrink-0 animate-pulse"
            title="Approval required"
          />
        )}

        {/* Assignee */}
        {assigneeName && (
          <span className="text-xs text-text-muted shrink-0 truncate max-w-30">
            {assigneeName}
          </span>
        )}

        {/* Actions (visible on hover) */}
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            className="p-1 rounded text-text-muted hover:text-accent hover:bg-accent-subtle"
            title="Add child task"
            onClick={(e) => {
              e.stopPropagation();
              onAddTask(node.task.id);
            }}
          >
            <Plus size={14} />
          </button>
          <button
            className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger-subtle"
            title="Delete task"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(node.task.id);
            }}
          >
            <Trash size={14} />
          </button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div className="space-y-1 mt-1">
          {node.children.map((child) => (
            <TaskNodeItem
              key={child.task.id}
              node={child}
              depth={depth + 1}
              selectedTaskId={selectedTaskId}
              pendingApprovalTaskIds={pendingApprovalTaskIds}
              onSelectTask={onSelectTask}
              onAddTask={onAddTask}
              onRequestDelete={onRequestDelete}
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
  pendingApprovalTaskIds,
  onSelectTask,
  onAddTask,
  onDeleteTask,
  onStatusChange,
  roleNames,
}: TaskTreeViewProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const tree = buildTree(tasks);

  if (tree.length === 0) {
    return (
      <div className="rounded-[var(--card-radius)] border border-dashed border-border-strong bg-surface-card p-12 text-center">
        <ListBullets size={40} className="mx-auto text-text-disabled mb-3" />
        <p className="text-sm text-text-muted mb-4">
          Your task board is empty. Create an epic to organize your project — epics contain stories, which break down into individual tasks for AI agents.
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover transition-colors"
          onClick={() => onAddTask(null)}
        >
          <Plus size={16} />
          Create Epic
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tree.map((node) => (
        <TaskNodeItem
          key={node.task.id}
          node={node}
          depth={0}
          selectedTaskId={selectedTaskId}
          pendingApprovalTaskIds={pendingApprovalTaskIds}
          onSelectTask={onSelectTask}
          onAddTask={onAddTask}
          onRequestDelete={setConfirmDelete}
          onStatusChange={onStatusChange}
          roleNames={roleNames}
        />
      ))}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Task?"
          message="This will permanently delete this task and may affect child tasks. This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            onDeleteTask(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
