import { useEffect, useState, useCallback } from 'react';
import { ListChecks, Plus, CaretRight, CaretDown, ShieldWarning, CheckCircle, CircleNotch, XCircle } from '@phosphor-icons/react';
import { useTaskStore } from '../../store/task.store';
import { useWorkflowSchema } from '../../hooks/use-workflow-schema';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import type { TaskRecord, RoleRecord, RunRecord } from '@core/shared/types';
import { TaskCreateModal } from './TaskCreateModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { toast } from '../../store/toast.store';

const api = () => window.capibara;

interface TasksPageProps {
  orgId: string | null;
}

interface TaskNode {
  task: TaskRecord;
  children: TaskNode[];
}

function buildTaskTree(tasks: TaskRecord[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];
  for (const task of tasks) map.set(task.id, { task, children: [] });
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

function TaskRow({
  node, depth, typeLabel, statusLabel, isTerminal, isApproval, isInitial, selectedId, onSelect, onApprove, onReject, onCancel, runningTaskIds,
}: {
  node: TaskNode;
  depth: number;
  typeLabel: (n: string) => string;
  statusLabel: (n: string) => string;
  isTerminal: (n: string) => boolean;
  isApproval: (n: string) => boolean;
  isInitial: (n: string) => boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  runningTaskIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const { task } = node;
  const terminal = isTerminal(task.status);
  const approval = isApproval(task.status);
  const initial = isInitial(task.status);
  const isRunning = runningTaskIds.has(task.id);
  const isSelected = task.id === selectedId;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          isSelected ? 'bg-accent border border-primary/30' : 'hover:bg-accent/50'
        }`}
        style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
        onClick={() => onSelect(task.id)}
      >
        {node.children.length > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="p-0.5">
            {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </button>
        ) : (
          <span className="w-5" />
        )}

        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{typeLabel(task.type)}</span>
        <span className={`flex-1 text-sm ${terminal ? 'line-through text-muted-foreground' : ''}`}>{task.title}</span>

        {approval && node.children.length === 0 && (
          <div className="flex items-center gap-1">
            <ShieldWarning size={16} className="text-yellow-500" />
            <button
              onClick={(e) => { e.stopPropagation(); onApprove(task.id); }}
              className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-600 hover:bg-green-500/20 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReject(task.id); }}
              className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors"
            >
              Reject
            </button>
          </div>
        )}

        {!terminal && !initial && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
            className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors opacity-0 group-hover:opacity-100"
            title="Cancel task"
          >
            <XCircle size={14} />
          </button>
        )}

        {terminal && <CheckCircle size={16} className="text-green-500" />}
        {isRunning && <CircleNotch size={16} className="text-blue-500 animate-spin" />}

        <span className={`text-xs px-1.5 py-0.5 rounded ${
          terminal ? 'bg-green-500/10 text-green-600' :
          approval ? 'bg-yellow-500/10 text-yellow-600' :
          isRunning ? 'bg-blue-500/10 text-blue-600 animate-pulse' :
          initial ? 'bg-gray-500/10 text-gray-600' :
          'bg-blue-500/10 text-blue-600'
        }`}>
          {statusLabel(task.status)}
        </span>
      </div>

      {expanded && node.children.map((child) => (
        <TaskRow
          key={child.task.id}
          node={child}
          depth={depth + 1}
          typeLabel={typeLabel}
          statusLabel={statusLabel}
          isTerminal={isTerminal}
          isApproval={isApproval}
          isInitial={isInitial}
          selectedId={selectedId}
          onSelect={onSelect}
          onApprove={onApprove}
          onReject={onReject}
          onCancel={onCancel}
          runningTaskIds={runningTaskIds}
        />
      ))}
    </div>
  );
}

export function TasksPage({ orgId }: TasksPageProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const setCurrentOrgId = useTaskStore((s) => s.setCurrentOrgId);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useTaskStore((s) => s.setSelectedTaskId);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const createTask = useTaskStore((s) => s.createTask);

  const { schema, getAllowedTypes, typeLabel, statusLabel, isTerminalStatus, isApprovalStatus, isInitialStatus, getAvailableTransitions } = useWorkflowSchema(orgId);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (orgId) {
      setCurrentOrgId(orgId);
      api().getRolesByOrgId(orgId).then((res: { ok: boolean; data?: RoleRecord[] }) => {
        if (res.ok && res.data) setRoles(res.data.filter((r: RoleRecord) => !r.isSystemRole));
      });
    }
  }, [orgId, setCurrentOrgId]);

  useEffect(() => {
    if (orgId) void loadTasks(orgId);
  }, [orgId, loadTasks]);

  useEffect(() => {
    if (!orgId) return;
    api().getRunsByOrgId(orgId).then((res: { ok: boolean; data?: RunRecord[] }) => {
      if (res.ok && res.data) {
        const ids = new Set<string>();
        for (const run of res.data) {
          if (run.taskId && (run.status === 'running' || run.status === 'queued')) {
            ids.add(run.taskId);
          }
        }
        setRunningTaskIds(ids);
      }
    });
  }, [orgId, tasks]);

  useEventSubscription(['task:changed', 'run:changed', 'run:completed'], useCallback(() => {
    if (orgId) void loadTasks(orgId);
  }, [orgId, loadTasks]));

  const handleApprove = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const transitions = getAvailableTransitions(task.status);
    const next = transitions.find((t) => !isApprovalStatus(t)) ?? transitions[0];
    if (!next) {
      toast.error(`No approval transition available from "${task.status}"`);
      return;
    }
    const res = await api().confirmApproval(taskId, next);
    if (!res.ok) {
      toast.error(res.error?.message ?? 'Approve failed');
      return;
    }
    if (orgId) void loadTasks(orgId);
  }, [orgId, tasks, loadTasks, getAvailableTransitions, isApprovalStatus]);

  const handleReject = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const transitions = getAvailableTransitions(task.status);
    const revert = transitions.find((t) => t === 'revision')
      ?? transitions.find((t) => !isApprovalStatus(t))
      ?? transitions[0];
    if (!revert) {
      toast.error(`No rejection transition available from "${task.status}"`);
      return;
    }
    const res = await api().rejectApproval(taskId, revert);
    if (!res.ok) {
      toast.error(res.error?.message ?? 'Reject failed');
      return;
    }
    if (orgId) void loadTasks(orgId);
  }, [orgId, tasks, loadTasks, getAvailableTransitions, isApprovalStatus]);

  const handleCancel = useCallback(async (taskId: string) => {
    const res = await api().cancelTask(taskId);
    if (res.ok) {
      toast.success('Task cancelled');
      if (orgId) void loadTasks(orgId);
    } else {
      toast.error(res.error?.message ?? 'Failed to cancel task');
    }
  }, [orgId, loadTasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const tree = buildTaskTree(tasks);

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <ListChecks size={48} weight="duotone" />
        <p>Select an organization to view tasks</p>
      </div>
    );
  }

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ListChecks size={28} weight="duotone" />
            Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{tasks.length} tasks</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} weight="bold" />
          Create Task
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : tree.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <ListChecks size={48} weight="duotone" />
          <p>No tasks yet. Create one or start a planning session.</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {tree.map((node) => (
            <TaskRow
              key={node.task.id}
              node={node}
              depth={0}
              typeLabel={typeLabel}
              statusLabel={statusLabel}
              isTerminal={isTerminalStatus}
              isApproval={isApprovalStatus}
              isInitial={isInitialStatus}
              selectedId={selectedTaskId}
              onSelect={setSelectedTaskId}
              onApprove={handleApprove}
              onReject={handleReject}
              onCancel={handleCancel}
              runningTaskIds={runningTaskIds}
            />
          ))}
        </div>
      )}

      {showCreateModal && orgId && (
        <TaskCreateModal
          orgId={orgId}
          parentId={null}
          roles={roles}
          allowedTypes={getAllowedTypes(null).length > 0
            ? getAllowedTypes(null)
            : [{ name: 'task', label: 'Task' }]}
          onClose={() => setShowCreateModal(false)}
          onSubmit={async (input) => {
            try {
              const res = await api().createTask(input);
              if (res.ok) {
                setShowCreateModal(false);
                if (orgId) void loadTasks(orgId);
                toast.success('Task created');
              } else {
                toast.error(res.error?.message ?? 'Failed to create task');
              }
            } catch (e) {
              toast.error(`Failed to create task: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
        />
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          roles={roles}
          typeLabel={typeLabel}
          statusLabel={statusLabel}
          isTerminal={isTerminalStatus}
          isApproval={isApprovalStatus}
          onCancel={handleCancel}
          onDelete={async (taskId) => {
            const ok = await useTaskStore.getState().deleteTask(taskId);
            if (ok) {
              setSelectedTaskId(null);
              toast.success('Task deleted');
            } else {
              toast.error('Failed to delete task');
            }
          }}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
