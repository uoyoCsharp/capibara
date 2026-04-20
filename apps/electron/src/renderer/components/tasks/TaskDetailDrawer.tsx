import { useState } from 'react';
import { ArrowRight, Trash, UserCircle } from '@phosphor-icons/react';
import type { TaskRecord, RoleRecord } from '@core/shared/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { useT } from '../../hooks/use-locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLocale = any;

interface TaskDetailDrawerProps {
  task: TaskRecord;
  roles: RoleRecord[];
  typeLabel: (name: string) => string;
  statusLabel: (name: string) => string;
  isTerminal: (name: string) => boolean;
  isApproval: (name: string) => boolean;
  availableTransitions: (from: string) => string[];
  onTransition: (taskId: string, newStatus: string) => void;
  onDelete: (taskId: string) => void;
  onClose: () => void;
}

export function TaskDetailDrawer({
  task,
  roles,
  typeLabel,
  statusLabel,
  isTerminal,
  isApproval,
  availableTransitions,
  onTransition,
  onDelete,
  onClose,
}: TaskDetailDrawerProps) {
  const t = useT() as AnyLocale;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const assignee = roles.find((r) => r.id === task.assigneeRoleId);
  const transitions = availableTransitions(task.status);
  const terminal = isTerminal(task.status);
  const approval = isApproval(task.status);

  const statusColor = terminal
    ? 'bg-green-500/10 text-green-600 border-green-500/30'
    : approval
    ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30'
    : 'bg-blue-500/10 text-blue-600 border-blue-500/30';

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="w-[420px] flex flex-col p-0 sm:max-w-[420px]">
          <SheetHeader className="px-5 py-4 border-b border-border space-y-0">
            <SheetTitle className="text-base truncate">{task.title}</SheetTitle>
            <SheetDescription className="sr-only">Task details</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-auto px-5 py-5 space-y-6">
            {/* Status & Type */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={statusColor}>
                {statusLabel(task.status)}
              </Badge>
              <Badge variant="secondary">
                {typeLabel(task.type)}
              </Badge>
            </div>

            {/* Assignee */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t.taskDetail?.assignee ?? 'Assignee'}
              </p>
              <div className="flex items-center gap-2">
                <UserCircle size={20} weight="fill" className="text-muted-foreground" />
                <span className="text-sm">
                  {assignee?.name ?? (t.taskDetail?.unassigned ?? 'Unassigned')}
                </span>
              </div>
            </div>

            {/* Description */}
            {task.description && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t.taskDetail?.description ?? 'Description'}
                </p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{task.description}</p>
              </div>
            )}

            {/* Metadata */}
            <div className="space-y-3">
              <Separator />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t.taskDetail?.created ?? 'Created'}</p>
                  <p className="text-foreground">{new Date(task.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t.taskDetail?.updated ?? 'Updated'}</p>
                  <p className="text-foreground">{new Date(task.updatedAt).toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Transitions */}
            {transitions.length > 0 && !terminal && (
              <div className="space-y-2">
                <Separator />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t.taskDetail?.actions ?? 'Actions'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {transitions.map((toStatus) => (
                    <Button
                      key={toStatus}
                      variant="outline"
                      size="sm"
                      onClick={() => onTransition(task.id, toStatus)}
                      className="gap-1.5"
                    >
                      <ArrowRight size={14} />
                      {statusLabel(toStatus)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <SheetFooter className="flex-row items-center justify-between px-5 py-4 border-t border-border sm:justify-between sm:space-x-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash size={16} />
              {t.common?.delete ?? 'Delete'}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t.common?.close ?? 'Close'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.taskDetail?.deleteConfirmTitle ?? 'Delete Task?'}</DialogTitle>
            <DialogDescription>
              {t.taskDetail?.deleteConfirmMessage ?? 'This action cannot be undone. The task and its data will be permanently removed.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              {t.common?.cancel ?? 'Cancel'}
            </Button>
            <Button variant="destructive" onClick={() => { onDelete(task.id); setShowDeleteConfirm(false); }}>
              {t.common?.delete ?? 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
