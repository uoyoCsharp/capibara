import { useState } from 'react';
import { CaretRight, CaretDown, Plus, Trash, ListBullets, CircleNotch } from '@phosphor-icons/react';
import type { TaskRecord, TaskStatus, TaskType } from '@shared/contracts';
import { cn } from '../../lib/utils';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/useLocale';

interface TaskTreeViewProps {
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  pendingApprovalTaskIds?: Set<string>;
  runningTaskIds?: Set<string>;
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
  pending: 'bg-muted-foreground',
  in_progress: 'bg-yellow-500',
  awaiting_review: 'bg-yellow-500',
  revision: 'bg-yellow-500',
  approved: 'bg-green-500',
  done: 'bg-green-500',
  blocked: 'bg-destructive',
  cancelled: 'bg-muted-foreground',
};

const TYPE_BADGE_COLORS: Record<TaskType, string> = {
  epic: 'bg-purple-100 text-purple-700',
  story: 'bg-blue-100 text-blue-700',
  task: 'bg-primary/10 text-primary',
  subtask: 'bg-muted text-muted-foreground',
  spike: 'bg-yellow-500/10 text-yellow-600',
  bug: 'bg-destructive/10 text-destructive',
  chore: 'bg-muted text-muted-foreground',
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
  runningTaskIds,
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
  runningTaskIds?: Set<string>;
  onSelectTask: (id: string) => void;
  onAddTask: (parentId: string) => void;
  onRequestDelete: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  roleNames: Map<string, string>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedTaskId === node.task.id;
  const assigneeName = node.task.assigneeRoleId
    ? roleNames.get(node.task.assigneeRoleId) ?? 'Unknown'
    : null;
  const hasApprovalPending = pendingApprovalTaskIds?.has(node.task.id) ||
    hasDescendantApproval(node, pendingApprovalTaskIds);
  const isRunning = runningTaskIds?.has(node.task.id) ?? false;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
          isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted',
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => onSelectTask(node.task.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className="shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
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
        {isRunning ? (
          <span className="shrink-0" title={t.tasksExecution.running}>
            <CircleNotch size={14} className="text-blue-500 animate-spin" />
          </span>
        ) : (
          <span
            className={cn(
              'w-2.5 h-2.5 rounded-full shrink-0',
              STATUS_COLORS[node.task.status],
            )}
            title={t.task[node.task.status]}
          />
        )}

        {/* Type badge */}
        <Badge
          variant="secondary"
          className={cn(
            'text-[10px] font-semibold uppercase px-1.5 py-0.5 shrink-0',
            TYPE_BADGE_COLORS[node.task.type],
          )}
        >
          {node.task.type}
        </Badge>

        {/* Title */}
        <span
          className={cn(
            'text-sm font-medium truncate flex-1',
            isSelected ? 'text-primary' : 'text-foreground',
            node.task.status === 'cancelled' && 'line-through text-muted-foreground/50',
          )}
        >
          {node.task.title}
        </span>

        {/* Approval notification badge (red dot) */}
        {hasApprovalPending && (
          <span
            className="w-2.5 h-2.5 rounded-full bg-destructive shrink-0 animate-pulse"
            title={t.taskDetail.approvalRequired}
          />
        )}

        {/* Assignee */}
        {assigneeName && (
          <span className="text-xs text-muted-foreground shrink-0 truncate max-w-30">
            {assigneeName}
          </span>
        )}

        {/* Actions (visible on hover) */}
        <div className="hidden group-hover:flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-primary"
            title="Add child task"
            onClick={(e) => {
              e.stopPropagation();
              onAddTask(node.task.id);
            }}
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            title="Delete task"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(node.task.id);
            }}
          >
            <Trash size={14} />
          </Button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div className="space-y-1.5 mt-1.5">
          {node.children.map((child) => (
            <TaskNodeItem
              key={child.task.id}
              node={child}
              depth={depth + 1}
              selectedTaskId={selectedTaskId}
              pendingApprovalTaskIds={pendingApprovalTaskIds}
              runningTaskIds={runningTaskIds}
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
  runningTaskIds,
  onSelectTask,
  onAddTask,
  onDeleteTask,
  onStatusChange,
  roleNames,
}: TaskTreeViewProps) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const tree = buildTree(tasks);

  if (tree.length === 0) {
    return (
      <div className="rounded-[var(--card-radius)] border border-dashed border-border bg-card p-12 text-center">
        <ListBullets size={40} className="mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground mb-4">
          {t.taskTree.emptyMessage}
        </p>
        <Button onClick={() => onAddTask(null)}>
          <Plus size={16} />
          {t.taskTree.createEpic}
        </Button>
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
          runningTaskIds={runningTaskIds}
          onSelectTask={onSelectTask}
          onAddTask={onAddTask}
          onRequestDelete={setConfirmDelete}
          onStatusChange={onStatusChange}
          roleNames={roleNames}
        />
      ))}
      {confirmDelete && (
        <ConfirmDialog
          title={t.taskTree.deleteConfirm}
          message={t.taskTree.deleteMessage}
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
