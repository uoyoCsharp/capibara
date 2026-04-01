import { useState, useEffect } from 'react';
import { X } from '@phosphor-icons/react';
import type { TaskType, RoleRecord, CreateTaskInput } from '@shared/contracts';
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

interface TaskCreateModalProps {
  orgId: string;
  parentId: string | null;
  parentType: TaskType | null;
  roles: RoleRecord[];
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
}

const TASK_TYPES: TaskType[] = ['epic', 'story', 'task', 'subtask', 'spike', 'bug', 'chore'];

const TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  epic: 'Large feature or initiative',
  story: 'User-facing requirement',
  task: 'Technical implementation work',
  subtask: 'Small piece of a larger task',
  spike: 'Research or investigation',
  bug: 'Defect fix',
  chore: 'Maintenance or housekeeping',
};

export function TaskCreateModal({
  orgId,
  parentId,
  parentType,
  roles,
  onClose,
  onSubmit,
}: TaskCreateModalProps) {
  const defaultType: TaskType = parentId ? 'task' : 'epic';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>(defaultType);
  const [assigneeRoleId, setAssigneeRoleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    onSubmit({
      orgId,
      parentId,
      type,
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
            {parentId ? 'Create Child Task' : 'Create New Task'}
          </DialogTitle>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              type="text"
              placeholder="Enter task title..."
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
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as TaskType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)} — {TYPE_DESCRIPTIONS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={4}
              placeholder="Describe the task..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Assignee Role */}
          <div className="space-y-2">
            <Label>Assignee Role</Label>
            <Select
              value={assigneeRoleId ?? '_unassigned'}
              onValueChange={(value) => setAssigneeRoleId(value === '_unassigned' ? null : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_unassigned">Unassigned</SelectItem>
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
              Cancel
            </Button>
            <Button type="submit">
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
