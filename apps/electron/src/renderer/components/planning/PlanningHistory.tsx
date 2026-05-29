import { ArrowLeft, ChatCircleText, CircleNotch, Plus } from '@phosphor-icons/react';
import type { PlanningHistoryRecord } from '@core/shared/types';
import { Button } from '../ui/button';
import { useT } from '../../hooks/use-locale';
import { cn } from '../../lib/utils';

interface PlanningHistoryProps {
  entries: PlanningHistoryRecord[];
  isLoading: boolean;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onBack: () => void;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Past planning conversations list (REQ-P2). Selecting an entry resumes that conversation;
 * the resume itself (load → rebuild fallback) is handled downstream by the session manager.
 */
export function PlanningHistory({ entries, isLoading, onSelect, onNew, onBack }: PlanningHistoryProps) {
  const t = useT();

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
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left',
                  'hover:bg-muted/40 transition-colors',
                )}
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
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {entry.state}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
