import { useState } from 'react';
import type { TaskType, RoleRecord, CreateTaskInput, WorkflowSchemaRecord } from '@shared/contracts';
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
import { useT } from '../../hooks/useLocale';

type ItemTypeDef = WorkflowSchemaRecord['workItemTypes'][number];

interface TaskCreateModalProps {
  orgId: string;
  parentId: string | null;
  parentType: TaskType | null;
  roles: RoleRecord[];
  /** Allowed types from the workflow schema (pre-filtered by parent) */
  allowedTypes: ItemTypeDef[];
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
}

export function TaskCreateModal({
  orgId,
  parentId,
  parentType,
  roles,
  allowedTypes,
  onClose,
  onSubmit,
}: TaskCreateModalProps) {
  const t = useT();
  const defaultType: TaskType = allowedTypes[0]?.name ?? '';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>(defaultType);
  const [assigneeRoleId, setAssigneeRoleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t.taskCreate.titleRequired);
      return;
    }
    if (!assigneeRoleId) {
      setError(t.taskCreate.assigneeRequired);
      return;
    }
    onSubmit({
      orgId,
      parentId,
      type: type as CreateTaskInput['type'],
      title: title.trim(),
      description: description.trim(),
      assigneeRoleId,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {parentId ? t.taskCreate.createChild : t.taskCreate.createNew}
          </DialogTitle>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label>{t.taskCreate.titleLabel}</Label>
            <Input
              type="text"
              placeholder={t.taskCreate.titlePlaceholder}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label>{t.taskCreate.typeLabel}</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as TaskType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((typeDef) => (
                  <SelectItem key={typeDef.name} value={typeDef.name}>
                    {typeDef.label} — {(t.taskTypeDesc as Record<string, string>)[typeDef.name] ?? typeDef.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>{t.taskCreate.descriptionLabel}</Label>
            <Textarea
              rows={4}
              placeholder={t.taskCreate.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Assignee Role */}
          <div className="space-y-2">
            <Label>
              {t.taskCreate.assigneeLabel}
              <span className="text-destructive ml-0.5">*</span>
            </Label>
            <Select
              value={assigneeRoleId ?? ''}
              onValueChange={(value) => {
                setAssigneeRoleId(value || null);
                setError(null);
              }}
            >
              <SelectTrigger className={cn(!assigneeRoleId && error ? 'border-destructive' : '')}>
                <SelectValue placeholder={t.taskCreate.assigneeLabel} />
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

          {/* Actions */}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit">
              {t.taskCreate.createTask}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
