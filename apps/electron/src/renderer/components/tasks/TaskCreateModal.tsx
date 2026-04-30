import { useEffect, useState } from 'react';
import type { RoleRecord } from '@core/shared/types';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '../ui/dialog';
import { useT } from '../../hooks/use-locale';

interface WorkItemType {
  name: string;
  label: string;
  canDecompose?: boolean;
}

type PlanningMode = 'layered' | 'eager' | 'preview';

interface TaskCreateModalProps {
  orgId: string;
  parentId: string | null;
  roles: RoleRecord[];
  allowedTypes: WorkItemType[];
  onClose: () => void;
  onSubmit: (input: {
    orgId: string;
    parentId: string | null;
    type: string;
    title: string;
    description: string;
    assigneeRoleId: string;
    planningMode: PlanningMode;
  }) => void;
}

export function TaskCreateModal({
  orgId,
  parentId,
  roles,
  allowedTypes,
  onClose,
  onSubmit,
}: TaskCreateModalProps) {
  const t = useT();
  const defaultType = allowedTypes[0]?.name ?? '';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState(defaultType);
  const [assigneeRoleId, setAssigneeRoleId] = useState<string | null>(null);
  const [planningMode, setPlanningMode] = useState<PlanningMode>('layered');
  const [error, setError] = useState<string | null>(null);

  const currentTypeDef = allowedTypes.find((t) => t.name === type);
  const canDecompose = currentTypeDef?.canDecompose ?? false;

  useEffect(() => {
    setPlanningMode('layered');
  }, [type]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t.taskCreate?.titleRequired ?? 'Title is required');
      return;
    }
    if (!assigneeRoleId) {
      setError(t.taskCreate?.assigneeRequired ?? 'Assignee is required');
      return;
    }

    onSubmit({
      orgId,
      parentId,
      type,
      title: title.trim(),
      description: description.trim(),
      assigneeRoleId,
      planningMode: canDecompose ? planningMode : 'layered',
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {parentId
              ? (t.taskCreate?.createChild ?? 'Create Sub-task')
              : (t.taskCreate?.createNew ?? 'Create Task')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label>{t.taskCreate?.titleLabel ?? 'Title'}</Label>
            <Input
              type="text"
              placeholder={t.taskCreate?.titlePlaceholder ?? 'Task title...'}
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(null); }}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* Type */}
          {allowedTypes.length > 0 && (
            <div className="space-y-2">
              <Label>{t.taskCreate?.typeLabel ?? 'Type'}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTypes.map((typeDef) => (
                    <SelectItem key={typeDef.name} value={typeDef.name}>
                      {typeDef.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label>{t.taskCreate?.descriptionLabel ?? 'Description'}</Label>
            <Textarea
              rows={4}
              placeholder={t.taskCreate?.descriptionPlaceholder ?? 'Describe the task...'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Assignee */}
          <div className="space-y-2">
            <Label>
              {t.taskCreate?.assigneeLabel ?? 'Assignee'}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Select
              value={assigneeRoleId ?? ''}
              onValueChange={(value) => { setAssigneeRoleId(value || null); setError(null); }}
            >
              <SelectTrigger className={cn(!assigneeRoleId && error ? 'border-destructive' : '')}>
                <SelectValue placeholder={t.taskCreate?.assigneeLabel ?? 'Select assignee...'} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Planning Mode — only for decomposable types */}
          {canDecompose && (
            <PlanningModeSelector value={planningMode} onChange={setPlanningMode} />
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common?.cancel ?? 'Cancel'}
            </Button>
            <Button type="submit">
              {t.taskCreate?.createTask ?? 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanningModeSelector({
  value,
  onChange,
}: {
  value: PlanningMode;
  onChange: (v: PlanningMode) => void;
}) {
  const options: Array<{ id: PlanningMode; title: string; hint: string; disabled?: boolean }> = [
    {
      id: 'layered',
      title: 'Layered',
      hint: 'Propose & approve at each level (default).',
    },
    {
      id: 'preview',
      title: 'Preview Tree',
      hint: 'AI drafts the full tree in one pass, you review then commit.',
    },
    {
      id: 'eager',
      title: 'Eager',
      hint: 'AI decomposes all the way to leaves and persists immediately. NO human review.',
    },
  ];

  return (
    <div className="space-y-2">
      <Label>Decomposition Mode</Label>
      <div className="space-y-1.5">
        {options.map((opt) => (
          <label
            key={opt.id}
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors',
              value === opt.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30',
              opt.disabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            <input
              type="radio"
              name="planningMode"
              value={opt.id}
              checked={value === opt.id}
              onChange={() => !opt.disabled && onChange(opt.id)}
              disabled={opt.disabled}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="font-medium text-foreground">{opt.title}</p>
              <p className="text-xs text-muted-foreground">{opt.hint}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
