import { useState, useEffect, useCallback } from 'react';
import {
  Tray,
  WarningCircle,
  Eye,
  ArrowRight,
  CircleNotch,
  Clock,
} from '@phosphor-icons/react';
import type { ConversationInboxItem, GroupedConversationsResult, SectionId } from '@shared/contracts';
import { useT } from '../../hooks/useLocale';
import { useCapibaraSnapshot } from '../../hooks/useCapibaraSnapshot';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';

interface InboxPageProps {
  onNavigate?: (section: SectionId) => void;
}

function formatElapsed(since: string): string {
  const ms = Date.now() - new Date(since).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export function InboxPage({ onNavigate }: InboxPageProps) {
  const t = useT();
  const { currentOrgId } = useCapibaraSnapshot();
  const [data, setData] = useState<GroupedConversationsResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentOrgId) { setData({ blocked: [], monitoring: [] }); setLoading(false); return; }
    try {
      const res = await window.capibara.getGroupedConversations(currentOrgId);
      if (res.ok) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [currentOrgId]);

  useEffect(() => { load(); }, [load]);

  // Subscribe to real-time conversation events for auto-refresh
  useEffect(() => {
    const unsub = window.capibara.subscribe((event) => {
      if (
        event.type === 'conversation:question-posted' ||
        event.type === 'conversation:resolved' ||
        event.type === 'conversation:cancelled' ||
        event.type === 'conversation:reply-posted'
      ) {
        load();
      }
    });
    // Also poll every 5s
    const interval = setInterval(load, 5000);
    return () => { unsub(); clearInterval(interval); };
  }, [load]);

  const handleGoToTask = (item: ConversationInboxItem) => {
    // Navigate to the tasks page — the execution page will show the task
    if (onNavigate) onNavigate('tasks');
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <CircleNotch size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const blocked = data?.blocked ?? [];
  const monitoring = data?.monitoring ?? [];
  const isEmpty = blocked.length === 0 && monitoring.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-6 py-5">
        <h1 className="text-2xl font-semibold text-foreground">{t.inbox.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.inbox.subtitle}</p>
      </div>

      <div className="flex-1 overflow-auto">
        {isEmpty ? (
          <div className="flex flex-1 h-full items-center justify-center">
            <div className="text-center">
              <Tray size={48} className="mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium text-muted-foreground">{t.inbox.noActiveConversations}</p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Blocked section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <WarningCircle size={18} weight="fill" className="text-destructive" />
                <h2 className="text-sm font-semibold text-foreground">{t.inbox.needsYourReply}</h2>
                {blocked.length > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    {blocked.length}
                  </Badge>
                )}
              </div>
              {blocked.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-7">{t.inbox.noBlockedConversations}</p>
              ) : (
                <div className="space-y-2">
                  {blocked.map((item) => (
                    <InboxRow
                      key={item.workflowId}
                      item={item}
                      variant="blocked"
                      onGoToTask={() => handleGoToTask(item)}
                    />
                  ))}
                </div>
              )}
            </section>

            <Separator />

            {/* Monitoring section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Eye size={18} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">{t.inbox.agentDiscussions}</h2>
                {monitoring.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {monitoring.length}
                  </Badge>
                )}
              </div>
              {monitoring.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-7">{t.inbox.noMonitoringConversations}</p>
              ) : (
                <div className="space-y-2">
                  {monitoring.map((item) => (
                    <InboxRow
                      key={item.workflowId}
                      item={item}
                      variant="monitoring"
                      onGoToTask={() => handleGoToTask(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Inbox Row ────────────────────────────── */

function InboxRow({
  item,
  variant,
  onGoToTask,
}: {
  item: ConversationInboxItem;
  variant: 'blocked' | 'monitoring';
  onGoToTask: () => void;
}) {
  const t = useT();
  const isBlocked = variant === 'blocked';

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer hover:bg-accent/50',
        isBlocked && 'border-destructive/20 bg-destructive/[0.02]',
      )}
      onClick={onGoToTask}
    >
      <div className="flex-1 min-w-0 space-y-1">
        {/* Task title */}
        <p className="text-sm font-medium text-foreground truncate">{item.taskTitle}</p>

        {/* Question preview */}
        {item.questionPreview && (
          <p className="text-xs text-muted-foreground line-clamp-2">{item.questionPreview}</p>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            {t.inbox.askingAgent}: <strong className="text-foreground">{item.askingRoleName}</strong>
          </span>
          <span>→</span>
          <span>
            {isBlocked
              ? t.inbox.waitingForYou
              : `${t.inbox.waitingForAgent}: ${item.respondentRoleName ?? '?'}`}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Clock size={11} />
            {formatElapsed(item.waitingSince)}
          </span>
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={(e) => { e.stopPropagation(); onGoToTask(); }}
      >
        <ArrowRight size={14} />
      </Button>
    </div>
  );
}
