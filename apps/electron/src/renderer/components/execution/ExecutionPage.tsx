import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Play, Stop, ArrowClockwise, Lightning } from '@phosphor-icons/react';
import type {
  OrganizationRecord,
  TaskRecord,
  RoleRecord,
  RunRecord,
  TaskStatus,
  TaskType,
  CreateTaskInput,
  RunStatus,
} from '@shared/contracts';
import { TaskTreeView } from '../tasks/TaskTreeView';
import { TaskCreateModal } from '../tasks/TaskCreateModal';
import { TaskDetailDrawer } from '../tasks/TaskDetailDrawer';
import { toast } from '../../store/toast.store';

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  queued: 'bg-warning-subtle text-warning-text',
  running: 'bg-info-subtle text-info-text',
  succeeded: 'bg-success-subtle text-success-text',
  failed: 'bg-danger-subtle text-danger-text',
  cancelled: 'bg-neutral-subtle text-neutral-text',
  interrupted: 'bg-warning-subtle text-warning-text',
};

export function ExecutionPage() {
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tasks' | 'runs'>('tasks');
  const [createModal, setCreateModal] = useState<{
    open: boolean;
    parentId: string | null;
    parentType: TaskType | null;
  }>({ open: false, parentId: null, parentType: null });

  const loadOrgs = useCallback(async () => {
    try {
      const result = await window.capibara.getOrganizations();
      if (result.ok) {
        setOrganizations(result.data);
        if (result.data.length > 0) {
          setCurrentOrgId((prev) => prev ?? result.data[0].id);
        }
      }
    } catch {
      toast.error('Failed to load organizations');
    }
  }, []);

  const loadOrgData = useCallback(async (orgId: string | null) => {
    if (!orgId) {
      setTasks([]);
      setRoles([]);
      setRuns([]);
      return;
    }
    try {
      const [taskRes, roleRes, runRes] = await Promise.all([
        window.capibara.getTasksByOrgId(orgId),
        window.capibara.getRolesByOrgId(orgId),
        window.capibara.getRunsByOrgId(orgId),
      ]);
      if (taskRes.ok) setTasks(taskRes.data);
      if (roleRes.ok) setRoles(roleRes.data);
      if (runRes.ok) setRuns(runRes.data);
    } catch {
      toast.error('Failed to load tasks and roles');
    }
  }, []);

  const loadRuns = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const result = await window.capibara.getRunsByOrgId(currentOrgId);
      if (result.ok) setRuns(result.data);
    } catch { toast.error('Failed to refresh runs'); }
  }, [currentOrgId]);

  const loadTasks = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const result = await window.capibara.getTasksByOrgId(currentOrgId);
      if (result.ok) setTasks(result.data);
    } catch { toast.error('Failed to refresh tasks'); }
  }, [currentOrgId]);

  useEffect(() => {
    loadOrgs().finally(() => setIsLoading(false));
  }, [loadOrgs]);

  useEffect(() => {
    loadOrgData(currentOrgId);
  }, [currentOrgId, loadOrgData]);

  // Subscribe to real-time events
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;
    const unsub = window.capibara.subscribe((event) => {
      if (!currentOrgId) return;
      if (
        (event.type === 'run:changed' && event.orgId === currentOrgId) ||
        (event.type === 'task:changed' && event.orgId === currentOrgId)
      ) {
        void loadOrgData(currentOrgId);
      }
    });
    return unsub;
  }, [currentOrgId, loadOrgData]);

  const roleNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of roles) {
      map.set(role.id, role.name);
    }
    return map;
  }, [roles]);

  const taskTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      map.set(task.id, task.title);
    }
    return map;
  }, [tasks]);

  const handleCreateTask = async (input: CreateTaskInput) => {
    try {
      const result = await window.capibara.createTask(input);
      if (result.ok) {
        setCreateModal({ open: false, parentId: null, parentType: null });
        await loadTasks();
      }
    } catch { toast.error('Failed to create task'); }
  };

  const handleStatusChange = async (id: string, status: TaskStatus) => {
    try {
      const result = await window.capibara.updateTaskStatus({ id, status });
      if (result.ok) {
        await loadTasks();
      }
    } catch { toast.error('Failed to update task status'); }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      const result = await window.capibara.deleteTask(id);
      if (result.ok) {
        if (selectedTaskId === id) setSelectedTaskId(null);
        await loadTasks();
      }
    } catch { toast.error('Failed to delete task'); }
  };

  const handleAddTask = (parentId: string | null) => {
    const parentTask = parentId ? tasks.find((t) => t.id === parentId) : null;
    setCreateModal({
      open: true,
      parentId,
      parentType: parentTask?.type ?? null,
    });
  };

  const handleStartRun = async (taskId: string, roleId: string) => {
    if (!currentOrgId) return;
    try {
      const result = await window.capibara.startRun({
        orgId: currentOrgId,
        taskNodeId: taskId,
        roleId,
        trigger: 'task_assigned',
      });
      if (result.ok) {
        await loadRuns();
        setActiveTab('runs');
      } else {
        console.warn('[StartRun]', result.error?.message);
      }
    } catch { toast.error('Failed to start run'); }
  };

  const handleCancelRun = async (runId: string) => {
    try {
      const result = await window.capibara.cancelRun(runId);
      if (result.ok) {
        await loadRuns();
      }
    } catch { toast.error('Failed to cancel run'); }
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  // Status summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  const runCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const run of runs) {
      counts[run.status] = (counts[run.status] ?? 0) + 1;
    }
    return counts;
  }, [runs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="p-[var(--page-padding)]">
        <h1 className="text-3xl font-semibold text-text-primary font-[family-name:var(--font-display)] mb-2">Tasks & Execution</h1>
        <p className="text-text-secondary mb-8">
          Create an organization first to start managing tasks. Organizations let you define AI agent teams and assign work.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-[var(--page-padding)] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-[var(--section-gap)]">
          <div>
            <h1 className="text-3xl font-semibold text-text-primary font-[family-name:var(--font-display)]">Tasks & Execution</h1>
            <p className="text-text-secondary text-sm mt-1">
              View and manage your task tree. Create epics, stories, and track execution progress.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Org selector */}
            <select
              className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
              value={currentOrgId ?? ''}
              onChange={(e) => {
                setCurrentOrgId(e.target.value);
                setSelectedTaskId(null);
                setSelectedRunId(null);
              }}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => handleAddTask(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover transition-colors"
            >
              <Plus size={16} />
              New Task
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-border-default mb-[var(--section-gap)]">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'tasks'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab('runs')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'runs'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            Runs ({runs.length})
            {(runCounts['running'] ?? 0) > 0 && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-info-subtle px-2 py-0.5 text-xs text-info-text">
                {runCounts['running']} active
              </span>
            )}
          </button>
        </div>

        {activeTab === 'tasks' && (
          <>
            {/* Status summary bar */}
            {tasks.length > 0 && (
              <div className="flex items-center gap-5 mb-[var(--section-gap)] text-xs text-text-tertiary">
                <span className="font-medium text-text-secondary">{tasks.length} tasks</span>
                {statusCounts['done'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    {statusCounts['done']} done
                  </span>
                )}
                {statusCounts['in_progress'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-warning" />
                    {statusCounts['in_progress']} in progress
                  </span>
                )}
                {statusCounts['blocked'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-danger" />
                    {statusCounts['blocked']} blocked
                  </span>
                )}
                {statusCounts['pending'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-neutral" />
                    {statusCounts['pending']} pending
                  </span>
                )}
              </div>
            )}

            {/* Task Tree */}
            <div className="rounded-[var(--card-radius)] border border-border-default bg-surface-card p-[var(--card-padding)]">
              <TaskTreeView
                tasks={tasks}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onStatusChange={handleStatusChange}
                roleNames={roleNames}
              />
            </div>
          </>
        )}

        {activeTab === 'runs' && (
          <div className="space-y-4">
            {runs.length === 0 ? (
              <div className="rounded-[var(--card-radius)] border border-border-default bg-surface-card p-8 text-center">
                <Lightning size={32} className="mx-auto text-text-disabled mb-3" />
                <p className="text-sm text-text-tertiary">
                  No runs yet. Select a task, assign it to a role, and click Execute to start an AI agent run.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-end mb-2">
                <button
                  onClick={loadRuns}
                  className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  <ArrowClockwise size={14} />
                  Refresh
                </button>
              </div>
            )}

            {runs.map((run) => (
              <div
                key={run.id}
                onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                className={`rounded-[var(--card-radius)] border bg-surface-card p-[var(--card-padding)] cursor-pointer transition-colors ${
                  selectedRunId === run.id
                    ? 'border-accent ring-1 ring-[var(--accent-ring)]'
                    : 'border-border-default hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${RUN_STATUS_COLORS[run.status]}`}
                    >
                      {run.status}
                    </span>
                    <span className="text-sm font-medium text-text-primary truncate max-w-[300px]">
                      {taskTitles.get(run.taskNodeId) ?? run.taskNodeId.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-text-muted shrink-0">
                    <span>{roleNames.get(run.roleId) ?? 'Unknown'}</span>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    {run.costUsd > 0 && (
                      <span className="text-success font-medium">${run.costUsd.toFixed(4)}</span>
                    )}
                    {(run.status === 'queued' || run.status === 'running') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCancelRun(run.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-danger-subtle px-2 py-1 text-xs font-medium text-danger-text hover:bg-danger/10 transition-colors"
                      >
                        <Stop size={12} />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded run details */}
                {selectedRunId === run.id && (
                  <div className="mt-4 pt-4 border-t border-border-subtle">
                    <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                      <div>
                        <span className="text-text-muted">Trigger:</span>{' '}
                        <span className="text-text-secondary">{run.trigger}</span>
                      </div>
                      <div>
                        <span className="text-text-muted">Started:</span>{' '}
                        <span className="text-text-secondary">
                          {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">Finished:</span>{' '}
                        <span className="text-text-secondary">
                          {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">Cost:</span>{' '}
                        <span className="text-text-secondary">${run.costUsd.toFixed(4)}</span>
                      </div>
                    </div>
                    {run.outputLog && (
                      <div>
                        <p className="text-xs text-text-muted mb-1">Output Log</p>
                        <pre className="bg-surface-sunken text-text-primary rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed">
                          {run.outputLog.slice(0, 5000)}
                          {run.outputLog.length > 5000 && '\n... (truncated)'}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedTask && activeTab === 'tasks' && (
        <TaskDetailDrawer
          task={selectedTask}
          roles={roles}
          onClose={() => setSelectedTaskId(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDeleteTask}
          onStartRun={handleStartRun}
          hasActiveRun={
            selectedTask.assigneeRoleId
              ? runs.some(
                  (r) =>
                    r.roleId === selectedTask.assigneeRoleId &&
                    (r.status === 'queued' || r.status === 'running'),
                )
              : false
          }
        />
      )}

      {/* Create Modal */}
      {createModal.open && currentOrgId && (
        <TaskCreateModal
          orgId={currentOrgId}
          parentId={createModal.parentId}
          parentType={createModal.parentType}
          roles={roles}
          onClose={() => setCreateModal({ open: false, parentId: null, parentType: null })}
          onSubmit={handleCreateTask}
        />
      )}
    </div>
  );
}
