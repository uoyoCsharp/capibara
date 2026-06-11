import { useState } from 'react';
import { ArrowLeft, ChatCircleText, CircleNotch, Plus, Trash } from '@phosphor-icons/react';
import type { PlanningHistoryRecord } from '@core/shared/types';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { useT } from '../../hooks/use-locale';
import { cn } from '../../lib/utils';

const TERMINAL_STATES = new Set<PlanningHistoryRecord['state']>([
  'resolved', 'cancelled', 'completed', 'timed_out', 'escalated',
]);

const STATE_STYLES: Record<PlanningHistoryRecord['state'], string> = {
  active: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400',
  waiting: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  resolved: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  completed: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-muted text-muted-foreground border-border',
  timed_out: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400',
  escalated: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400',
};

interface DeleteResult {
  ok: boolean;
  message?: string;
}

interface PlanningHistoryProps {
  entries: PlanningHistoryRecord[];
  isLoading: boolean;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onBack: () => void;
  onDelete: (conversationId: string) => Promise<DeleteResult>;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function PlanningHistory({ entries, isLoading, onSelect, onNew, onBack, onDelete }: PlanningHistoryProps) {
  const t = useT();
  const [deleteTarget, setDeleteTarget] = useState<PlanningHistoryRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await onDelete(deleteTarget.id);
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t.planning.backToDashboard}
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-sm font-semibold">{t.planning.history.title}</h1>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus size={14} className="mr-1.5" />
          {t.planning.history.newSession}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
            <CircleNotch size={16} className="animate-spin" />
            {t.planning.loading}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <ChatCircleText size={40} weight="duotone" />
            <p className="text-sm">{t.planning.history.empty}</p>
            <Button size="sm" variant="outline" onClick={onNew}>
              <Plus size={14} className="mr-1.5" />
              {t.planning.history.newSession}
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5 max-w-2xl mx-auto">
            {entries.map((entry) => {
              const canDelete = TERMINAL_STATES.has(entry.state);
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'group w-full flex items-center gap-3 rounded-md border border-border text-left',
                    'hover:bg-muted/40 transition-colors',
                  )}
                >
                  <button
                    onClick={() => onSelect(entry.id)}
                    className="flex-1 flex items-center gap-3 px-3 py-2.5 min-w-0"
                  >
                    <ChatCircleText size={18} weight="duotone" className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {entry.title || t.planning.history.untitled}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimestamp(entry.updatedAt)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-[11px] font-normal shrink-0', STATE_STYLES[entry.state])}
                    >
                      {t.planning.history.states[entry.state]}
                    </Badge>
                  </button>
                  <div className="shrink-0 pr-2">
                    {canDelete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry); }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        title={t.common.delete}
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.planning.history.deleteTitle}</DialogTitle>
            <DialogDescription>
              {t.planning.history.deleteMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
              {isDeleting && <CircleNotch size={14} className="mr-1.5 animate-spin" />}
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
