import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Play, Stop, ArrowClockwise, Lightning, Timer } from '@phosphor-icons/react';
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
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { TaskTreeView } from '../tasks/TaskTreeView';
import { TaskCreateModal } from '../tasks/TaskCreateModal';
import { TaskDetailDrawer } from '../tasks/TaskDetailDrawer';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  queued: 'bg-yellow-500/10 text-yellow-600',
  running: 'bg-blue-500/10 text-blue-600',
  succeeded: 'bg-green-500/10 text-green-600',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  interrupted: 'bg-yellow-500/10 text-yellow-600',
};

interface RunCardProps {
  run: RunRecord;
  isSelected: boolean;
  taskTitle: string;
  roleName: string;
  onSelect: () => void;
  onCancel: (runId: string) => void;
}

function RunCard({ run, isSelected, taskTitle, roleName, onSelect, onCancel }: RunCardProps) {
  const t = useT();
  const elapsed = useElapsedTimer(run.status === 'running' ? run.startedAt : null);

  return (
    <Card
      onClick={onSelect}
      className={cn(
        'cursor-pointer transition-colors',
        isSelected
          ? 'border-primary ring-1 ring-primary/30'
          : 'hover:border-foreground/20',
      )}
    >
      <CardContent className="p-[var(--card-padding)]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge
              variant="secondary"
              className={cn('text-xs font-medium', RUN_STATUS_COLORS[run.status])}
            >
              {run.status}
            </Badge>
            {elapsed && (
              <span className="flex items-center gap-1 text-xs font-mono text-blue-600">
                <Timer size={12} className="animate-spin" style={{ animationDuration: '3s' }} />
                {elapsed}
              </span>
            )}
            <span className="text-sm font-medium text-foreground truncate max-w-[300px]">
              {taskTitle}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
            <span>{roleName}</span>
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            {run.costUsd > 0 && (
              <span className="text-green-600 font-medium">${run.costUsd.toFixed(4)}</span>
            )}
            {(run.status === 'queued' || run.status === 'running') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(run.id);
                }}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Stop size={12} />
                {t.tasksExecution.cancelRun}
              </Button>
            )}
          </div>
        </div>

        {/* Expanded run details */}
        {isSelected && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="grid grid-cols-2 gap-4 text-xs mb-4">
              <div>
                <span className="text-muted-foreground">{t.tasksExecution.trigger}:</span>{' '}
                <span className="text-foreground">{run.trigger}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t.tasksExecution.started}:</span>{' '}
                <span className="text-foreground">
                  {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t.tasksExecution.finished}:</span>{' '}
                <span className="text-foreground">
                  {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '-'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t.tasksExecution.cost}:</span>{' '}
                <span className="text-foreground">${run.costUsd.toFixed(4)}</span>
              </div>
            </div>
            {run.outputLog && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t.tasksExecution.outputLog}</p>
                <pre className="bg-muted text-foreground rounded-lg p-3 text-xs overflow-auto max-h-64 font-mono leading-relaxed">
                  {run.outputLog.slice(0, 5000)}
                  {run.outputLog.length > 5000 && `\n${t.common.truncated}`}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ExecutionPage() {
  const t = useT();
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('tasks');
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
      toast.error(t.errors.failedToLoad);
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
      toast.error(t.tasksExecution.failedToLoadTasks);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const result = await window.capibara.getRunsByOrgId(currentOrgId);
      if (result.ok) setRuns(result.data);
    } catch { toast.error(t.tasksExecution.failedToRefreshRuns); }
  }, [currentOrgId]);

  const loadTasks = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const result = await window.capibara.getTasksByOrgId(currentOrgId);
      if (result.ok) setTasks(result.data);
    } catch { toast.error(t.tasksExecution.failedToRefreshTasks); }
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
    } catch { toast.error(t.tasksExecution.failedToCreateTask); }
  };

  const handleStatusChange = async (id: string, status: TaskStatus) => {
    try {
      const result = await window.capibara.updateTaskStatus({ id, status });
      if (result.ok) {
        await loadTasks();
      }
    } catch { toast.error(t.tasksExecution.failedToUpdateStatus); }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      const result = await window.capibara.deleteTask(id);
      if (result.ok) {
        if (selectedTaskId === id) setSelectedTaskId(null);
        await loadTasks();
      }
    } catch { toast.error(t.tasksExecution.failedToDeleteTask); }
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
    } catch { toast.error(t.tasksExecution.failedToStartRun); }
  };

  const handleCancelRun = async (runId: string) => {
    try {
      const result = await window.capibara.cancelRun(runId);
      if (result.ok) {
        await loadRuns();
      }
    } catch { toast.error(t.tasksExecution.failedToCancelRun); }
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
        <p className="text-sm text-muted-foreground">{t.common.loading}</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="p-[var(--page-padding)]">
        <h1 className="text-3xl font-semibold text-foreground font-[family-name:var(--font-display)] mb-2">{t.tasksExecution.title}</h1>
        <p className="text-muted-foreground mb-8">
          {t.tasksExecution.noOrgMessage}
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
            <h1 className="text-3xl font-semibold text-foreground font-[family-name:var(--font-display)]">{t.tasksExecution.title}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t.tasksExecution.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Org selector */}
            <Select
              value={currentOrgId ?? ''}
              onValueChange={(value) => {
                setCurrentOrgId(value);
                setSelectedTaskId(null);
                setSelectedRunId(null);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={() => handleAddTask(null)}>
              <Plus size={16} />
              {t.tasksExecution.newTask}
            </Button>
          </div>
        </div>

        {/* Tab Bar */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-[var(--section-gap)]">
          <TabsList>
            <TabsTrigger value="tasks">
              {t.tasksExecution.tasksTab} ({tasks.length})
            </TabsTrigger>
            <TabsTrigger value="runs" className="gap-1.5">
              {t.tasksExecution.runsTab} ({runs.length})
              {(runCounts['running'] ?? 0) > 0 && (
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 text-xs">
                  {runCounts['running']} {t.tasksExecution.activeCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks">
            {/* Status summary bar */}
            {tasks.length > 0 && (
              <div className="flex items-center gap-5 mb-[var(--section-gap)] text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{tasks.length} {t.tasksExecution.tasksCount}</span>
                {statusCounts['done'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    {statusCounts['done']} {t.tasksExecution.doneCount}
                  </span>
                )}
                {statusCounts['in_progress'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    {statusCounts['in_progress']} {t.tasksExecution.inProgressCount}
                  </span>
                )}
                {statusCounts['blocked'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-destructive" />
                    {statusCounts['blocked']} {t.tasksExecution.blockedCount}
                  </span>
                )}
                {statusCounts['pending'] && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                    {statusCounts['pending']} {t.tasksExecution.pendingCount}
                  </span>
                )}
              </div>
            )}

            {/* Task Tree */}
            <Card>
              <CardContent className="p-[var(--card-padding)]">
                <TaskTreeView
                  tasks={tasks}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={setSelectedTaskId}
                  onAddTask={handleAddTask}
                  onDeleteTask={handleDeleteTask}
                  onStatusChange={handleStatusChange}
                  roleNames={roleNames}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs">
            <div className="space-y-4">
              {runs.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Lightning size={32} className="mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {t.tasksExecution.noRunsMessage}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex items-center justify-end mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadRuns}
                  >
                    <ArrowClockwise size={14} />
                    {t.common.refresh}
                  </Button>
                </div>
              )}

              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  isSelected={selectedRunId === run.id}
                  taskTitle={taskTitles.get(run.taskNodeId) ?? run.taskNodeId.slice(0, 8)}
                  roleName={roleNames.get(run.roleId) ?? t.common.unknown}
                  onSelect={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                  onCancel={(runId) => void handleCancelRun(runId)}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
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
