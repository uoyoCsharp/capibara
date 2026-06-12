import { useState, useMemo } from 'react';
import { X, Lock, CheckCircle, CircleNotch, Clock, Warning } from '@phosphor-icons/react';
import type { TaskRecord, TaskDependencyRecord } from '@core/shared/types';
import { useTaskStore } from '../../store/task.store';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { toast } from '../../store/toast.store';
import { useT } from '../../hooks/use-locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLocale = any;

interface DependencySelectorProps {
  task: TaskRecord;
  tasks: TaskRecord[];
  statusLabel: (name: string) => string;
  isTerminal: (name: string) => boolean;
}

function getStatusIcon(status: string, isTerminal: boolean) {
  if (isTerminal) return <CheckCircle size={14} className="text-green-500" />;
  if (status === 'in_progress') return <CircleNotch size={14} className="text-blue-500 animate-spin" />;
  if (status === 'blocked') return <Lock size={14} className="text-red-500" />;
  if (status === 'pending') return <Clock size={14} className="text-yellow-500" />;
  return <Warning size={14} className="text-gray-400" />;
}

export function DependencySelector({
  task,
  tasks,
  statusLabel,
  isTerminal,
}: DependencySelectorProps) {
  const t = useT() as AnyLocale;
  const dependencies = useTaskStore((s) => s.dependencies);
  const addDependency = useTaskStore((s) => s.addDependency);
  const removeDependency = useTaskStore((s) => s.removeDependency);

  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  const taskDependencies = useMemo(
    () => dependencies.filter((d) => d.dependentTaskId === task.id),
    [dependencies, task.id]
  );

  const availableTasks = useMemo(() => {
    const dependencyIds = new Set(taskDependencies.map((d) => d.dependencyTaskId));
    return tasks.filter(
      (t) =>
        t.id !== task.id &&
        !dependencyIds.has(t.id) &&
        t.orgId === task.orgId &&
        !isTerminal(t.status)
    );
  }, [tasks, task, taskDependencies, isTerminal]);

  const handleAdd = async () => {
    if (!selectedTaskId) return;

    const success = await addDependency(task.orgId, task.id, selectedTaskId);
    if (success) {
      setSelectedTaskId('');
    } else {
      toast.error(t.dependencies?.addError ?? 'Failed to add dependency. Circular dependency detected.');
    }
  };

  const handleRemove = async (dependencyId: string) => {
    const success = await removeDependency(dependencyId);
    if (!success) {
      toast.error(t.dependencies?.removeError ?? 'Failed to remove dependency');
    }
  };

  const getDependencyTask = (dep: TaskDependencyRecord): TaskRecord | undefined => {
    return tasks.find((t) => t.id === dep.dependencyTaskId);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t.dependencies?.label ?? 'Dependencies'}
      </p>

      {taskDependencies.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {t.dependencies?.none ?? 'No dependencies. This task can start immediately.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {taskDependencies.map((dep) => {
            const depTask = getDependencyTask(dep);
            const depStatus = depTask?.status ?? dep.dependencyTaskStatus ?? 'unknown';
            const depIsTerminal = isTerminal(depStatus);

            return (
              <div
                key={dep.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/50 border border-border/50"
              >
                {getStatusIcon(depStatus, depIsTerminal)}
                <span className="flex-1 text-sm truncate">
                  {dep.dependencyTaskTitle ?? depTask?.title ?? 'Unknown task'}
                </span>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    depIsTerminal
                      ? 'bg-green-500/10 text-green-600 border-green-500/30'
                      : depStatus === 'blocked'
                      ? 'bg-red-500/10 text-red-600 border-red-500/30'
                      : depStatus === 'in_progress'
                      ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                      : 'bg-gray-500/10 text-gray-600 border-gray-500/30'
                  }`}
                >
                  {statusLabel(depStatus)}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(dep.id)}
                >
                  <X size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {availableTasks.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue placeholder={t.dependencies?.addPlaceholder ?? 'Add dependency...'} />
            </SelectTrigger>
            <SelectContent>
              {availableTasks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-2">
                    {getStatusIcon(t.status, isTerminal(t.status))}
                    {t.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={!selectedTaskId}
            onClick={handleAdd}
          >
            {t.dependencies?.addBtn ?? 'Add'}
          </Button>
        </div>
      )}
    </div>
  );
}
