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

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  queued: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  succeeded: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
  interrupted: 'bg-orange-100 text-orange-700',
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
    const result = await window.capibara.getOrganizations();
    if (result.ok) {
      setOrganizations(result.data);
      if (result.data.length > 0 && !currentOrgId) {
        setCurrentOrgId(result.data[0].id);
      }
    }
  }, [currentOrgId]);

  const loadTasks = useCallback(async () => {
    if (!currentOrgId) {
      setTasks([]);
      return;
    }
    const result = await window.capibara.getTasksByOrgId(currentOrgId);
    if (result.ok) {
      setTasks(result.data);
    }
  }, [currentOrgId]);

  const loadRoles = useCallback(async () => {
    if (!currentOrgId) {
      setRoles([]);
      return;
    }
    const result = await window.capibara.getRolesByOrgId(currentOrgId);
    if (result.ok) {
      setRoles(result.data);
    }
  }, [currentOrgId]);

  const loadRuns = useCallback(async () => {
    if (!currentOrgId) {
      setRuns([]);
      return;
    }
    const result = await window.capibara.getRunsByOrgId(currentOrgId);
    if (result.ok) {
      setRuns(result.data);
    }
  }, [currentOrgId]);

  useEffect(() => {
    loadOrgs().then(() => setIsLoading(false));
  }, [loadOrgs]);

  useEffect(() => {
    loadTasks();
    loadRoles();
    loadRuns();
  }, [loadTasks, loadRoles, loadRuns]);

  // Auto-refresh runs every 5 seconds when there are active runs
  useEffect(() => {
    const hasActiveRuns = runs.some((r) => r.status === 'queued' || r.status === 'running');
    if (!hasActiveRuns || !currentOrgId) return;
    const interval = setInterval(loadRuns, 5000);
    return () => clearInterval(interval);
  }, [runs, currentOrgId, loadRuns]);

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
    const result = await window.capibara.createTask(input);
    if (result.ok) {
      setCreateModal({ open: false, parentId: null, parentType: null });
      await loadTasks();
    }
  };

  const handleStatusChange = async (id: string, status: TaskStatus) => {
    const result = await window.capibara.updateTaskStatus({ id, status });
    if (result.ok) {
      await loadTasks();
    }
  };

  const handleDeleteTask = async (id: string) => {
    const result = await window.capibara.deleteTask(id);
    if (result.ok) {
      if (selectedTaskId === id) setSelectedTaskId(null);
      await loadTasks();
    }
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
    const result = await window.capibara.startRun({
      orgId: currentOrgId,
      taskNodeId: taskId,
      roleId,
      trigger: 'task_assigned',
    });
    if (result.ok) {
      await loadRuns();
      setActiveTab('runs');
    }
  };

  const handleCancelRun = async (runId: string) => {
    const result = await window.capibara.cancelRun(runId);
    if (result.ok) {
      await loadRuns();
    }
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
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Tasks & Execution</h1>
        <p className="text-gray-500 mb-8">
          Create an organization first to start adding tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-8 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Tasks & Execution</h1>
            <p className="text-gray-500 text-sm mt-1">
              View and manage your task tree. Create epics, stories, and track execution progress.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Org selector */}
            <select
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus size={16} />
              New Task
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'tasks'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab('runs')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'runs'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Runs ({runs.length})
            {(runCounts['running'] ?? 0) > 0 && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                {runCounts['running']} active
              </span>
            )}
          </button>
        </div>

        {activeTab === 'tasks' && (
          <>
            {/* Status summary bar */}
            {tasks.length > 0 && (
              <div className="flex items-center gap-4 mb-6 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{tasks.length} tasks</span>
                {statusCounts['done'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    {statusCounts['done']} done
                  </span>
                )}
                {statusCounts['in_progress'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    {statusCounts['in_progress']} in progress
                  </span>
                )}
                {statusCounts['blocked'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    {statusCounts['blocked']} blocked
                  </span>
                )}
                {statusCounts['pending'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-300" />
                    {statusCounts['pending']} pending
                  </span>
                )}
              </div>
            )}

            {/* Task Tree */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
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
          <div className="space-y-3">
            {runs.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                <Lightning size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">
                  No runs yet. Assign a task to a role and start execution.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-end mb-2">
                <button
                  onClick={loadRuns}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
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
                className={`rounded-xl border bg-white p-4 cursor-pointer transition-colors ${
                  selectedRunId === run.id
                    ? 'border-indigo-300 ring-1 ring-indigo-200'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${RUN_STATUS_COLORS[run.status]}`}
                    >
                      {run.status}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate max-w-[300px]">
                      {taskTitles.get(run.taskNodeId) ?? run.taskNodeId.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{roleNames.get(run.roleId) ?? 'Unknown'}</span>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    {run.costUsd > 0 && (
                      <span className="text-green-600 font-medium">${run.costUsd.toFixed(4)}</span>
                    )}
                    {(run.status === 'queued' || run.status === 'running') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCancelRun(run.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                      >
                        <Stop size={12} />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded run details */}
                {selectedRunId === run.id && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                      <div>
                        <span className="text-gray-400">Trigger:</span>{' '}
                        <span className="text-gray-700">{run.trigger}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">Started:</span>{' '}
                        <span className="text-gray-700">
                          {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">Finished:</span>{' '}
                        <span className="text-gray-700">
                          {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400">Cost:</span>{' '}
                        <span className="text-gray-700">${run.costUsd.toFixed(4)}</span>
                      </div>
                    </div>
                    {run.outputLog && (
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Output Log</p>
                        <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed">
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
