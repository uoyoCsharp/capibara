import { ChatCircle, X, ArrowUp, Clock, CheckCircle, Warning } from '@phosphor-icons/react';
import type { ConversationWorkflowRecord } from '@shared/contracts';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

interface ConversationListProps {
  conversations: ConversationWorkflowRecord[];
  isLoading: boolean;
  showResolved: boolean;
  onToggleResolved: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCancel: (id: string) => void;
}

const TERMINAL_STATES = ['resolved', 'timed_out', 'cancelled'];

const STATE_STYLES: Record<string, { color: string; icon: typeof CheckCircle }> = {
  waiting_for_reply: { color: 'text-blue-500', icon: Clock },
  reply_received: { color: 'text-green-500', icon: ChatCircle },
  resumed: { color: 'text-emerald-500', icon: ChatCircle },
  resolved: { color: 'text-muted-foreground', icon: CheckCircle },
  escalated: { color: 'text-orange-500', icon: ArrowUp },
  timed_out: { color: 'text-red-500', icon: Warning },
  cancelled: { color: 'text-muted-foreground', icon: X },
};

export function ConversationList({
  conversations,
  isLoading,
  showResolved,
  onToggleResolved,
  selectedId,
  onSelect,
  onCancel,
}: ConversationListProps) {
  const t = useT();

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {conversations.length} {t.conversations.title.toLowerCase()}
        </span>
        <Button variant="ghost" size="sm" onClick={onToggleResolved}>
          {showResolved ? t.conversations.hideResolved : t.conversations.showResolved}
        </Button>
      </div>

      {conversations.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.conversations.noConversations}</p>
      ) : (
        <div className="space-y-2">
          {conversations
            .sort((a, b) => b.priority - a.priority || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((wf) => {
              const style = STATE_STYLES[wf.state] ?? STATE_STYLES.waiting_for_reply;
              const StateIcon = style.icon;
              const isSelected = selectedId === wf.id;
              const isTerminal = TERMINAL_STATES.includes(wf.state);
              const elapsed = Date.now() - new Date(wf.createdAt).getTime();

              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => onSelect(wf.id)}
                  className={cn(
                    'w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent/50',
                    isSelected && 'border-primary bg-accent/30',
                    wf.respondentType === 'human' && !isTerminal && 'border-yellow-500/50 bg-yellow-500/5',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <StateIcon className={cn('h-4 w-4 shrink-0', style.color)} weight="bold" />
                      <span className="truncate text-sm font-medium">
                        {wf.askingRoleId.slice(0, 8)}...
                      </span>
                      <span className="text-xs text-muted-foreground">→</span>
                      <span className="truncate text-sm">
                        {wf.respondentType === 'human'
                          ? '👤 Human'
                          : wf.respondentRoleId
                            ? wf.respondentRoleId.slice(0, 8) + '...'
                            : '—'
                        }
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {wf.priority >= 2 && (
                        <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-600">
                          P{wf.priority}
                        </span>
                      )}
                      {wf.depth > 0 && (
                        <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                          D{wf.depth}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className={style.color}>{stateLabel(wf.state, t)}</span>
                    <span>{formatElapsed(elapsed)}</span>
                    {wf.respondentType === 'human' && !isTerminal && (
                      <span className="font-medium text-yellow-600">{t.conversations.needsHumanReply}</span>
                    )}
                  </div>

                  {!isTerminal && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancel(wf.id);
                        }}
                      >
                        <X className="mr-1 h-3 w-3" />
                        {t.conversations.cancelConversation}
                      </Button>
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function stateLabel(state: string, t: ReturnType<typeof useT>): string {
  const map: Record<string, string> = {
    waiting_for_reply: t.conversations.waitingForReply,
    reply_received: t.conversations.replyReceived,
    resumed: t.conversations.resumed,
    resolved: t.conversations.resolved,
    escalated: t.conversations.escalated,
    timed_out: t.conversations.timedOut,
    cancelled: t.conversations.cancelled,
  };
  return map[state] ?? state;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
