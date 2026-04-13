import { useState, useEffect, useCallback } from 'react';
import {
  Tray,
  WarningCircle,
  Eye,
  ArrowRight,
  CircleNotch,
  Clock,
  ClockCounterClockwise,
  CheckCircle,
  CaretDown,
  CaretRight,
} from '@phosphor-icons/react';
import type { ConversationInboxItem, ConversationWorkflowRecord, GroupedConversationsResult, SectionId } from '@shared/contracts';
import { useT } from '../../hooks/useLocale';
import { useCapibaraSnapshot } from '../../hooks/useCapibaraSnapshot';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet';
import { ConversationReplyPanel } from '../conversations/ConversationReplyPanel';
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
  const [selectedItem, setSelectedItem] = useState<ConversationInboxItem | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConversationInboxItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ConversationInboxItem | null>(null);

  const load = useCallback(async () => {
    if (!currentOrgId) { setData({ blocked: [], monitoring: [] }); setLoading(false); return; }
    try {
      const res = await window.capibara.getGroupedConversations(currentOrgId);
      if (res.ok) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [currentOrgId]);

  const loadHistory = useCallback(async () => {
    if (!currentOrgId) { setHistoryItems([]); return; }
    try {
      const res = await window.capibara.getResolvedConversations(currentOrgId);
      if (res.ok) setHistoryItems(res.data);
    } catch { /* silent */ }
  }, [currentOrgId]);

  useEffect(() => { load(); }, [load]);

  // Load history when expanded
  useEffect(() => {
    if (historyExpanded) loadHistory();
  }, [historyExpanded, loadHistory]);

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
    if (onNavigate) onNavigate('tasks');
  };

  const handleBlockedClick = (item: ConversationInboxItem) => {
    setSelectedItem(item);
  };

  const handleReplied = () => {
    setSelectedItem(null);
    load();
  };

  // Build a read-only workflow record for history items (state != waiting → no input box)
  const historyWorkflow: ConversationWorkflowRecord | null = selectedHistoryItem
    ? {
        id: selectedHistoryItem.workflowId,
        orgId: currentOrgId ?? '',
        taskNodeId: selectedHistoryItem.taskNodeId,
        discussionGroupId: selectedHistoryItem.discussionGroupId,
        askingRoleId: selectedHistoryItem.askingRoleId,
        askingRunId: '',
        respondentRoleId: selectedHistoryItem.respondentRoleId,
        respondentType: selectedHistoryItem.respondentType,
        state: 'resolved',
        depth: selectedHistoryItem.depth,
        parentWorkflowId: null,
        priority: selectedHistoryItem.priority,
        timeoutAt: null,
        resolvedAt: selectedHistoryItem.waitingSince,
        createdAt: selectedHistoryItem.waitingSince,
        updatedAt: selectedHistoryItem.waitingSince,
      }
    : null;

  // Build a minimal ConversationWorkflowRecord for the reply panel
  const selectedWorkflow: ConversationWorkflowRecord | null = selectedItem
    ? {
        id: selectedItem.workflowId,
        orgId: currentOrgId ?? '',
        taskNodeId: selectedItem.taskNodeId,
        discussionGroupId: selectedItem.discussionGroupId,
        askingRoleId: selectedItem.askingRoleId,
        askingRunId: '',
        respondentRoleId: selectedItem.respondentRoleId,
        respondentType: selectedItem.respondentType,
        state: 'waiting_for_reply',
        depth: selectedItem.depth,
        parentWorkflowId: null,
        priority: selectedItem.priority,
        timeoutAt: null,
        resolvedAt: null,
        createdAt: selectedItem.waitingSince,
        updatedAt: selectedItem.waitingSince,
      }
    : null;

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
          <div className="flex flex-1 h-full flex-col">
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Tray size={48} className="mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-lg font-medium text-muted-foreground">{t.inbox.noActiveConversations}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 text-muted-foreground"
                  onClick={() => setHistoryExpanded((v) => !v)}
                >
                  <ClockCounterClockwise size={14} className="mr-1.5" />
                  {historyExpanded ? t.inbox.hideHistory : t.inbox.showHistory}
                </Button>
              </div>
            </div>
            {historyExpanded && (
              <div className="p-6 pt-0 border-t">
                <h2 className="text-sm font-semibold text-foreground mt-4 mb-3">{t.inbox.recentlyResolved}</h2>
                {historyItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t.inbox.noResolvedConversations}</p>
                ) : (
                  <div className="space-y-2">
                    {historyItems.map((item) => (
                      <HistoryRow
                        key={item.workflowId}
                        item={item}
                        onClick={() => setSelectedHistoryItem(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
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
                      onGoToTask={() => handleBlockedClick(item)}
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

            <Separator />

            {/* History section */}
            <section>
              <button
                type="button"
                onClick={() => setHistoryExpanded((v) => !v)}
                className="flex w-full items-center gap-2 mb-3"
              >
                {historyExpanded
                  ? <CaretDown size={14} className="text-muted-foreground" />
                  : <CaretRight size={14} className="text-muted-foreground" />}
                <ClockCounterClockwise size={18} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">{t.inbox.recentlyResolved}</h2>
              </button>
              {historyExpanded && (
                historyItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-7">{t.inbox.noResolvedConversations}</p>
                ) : (
                  <div className="space-y-2">
                    {historyItems.map((item) => (
                      <HistoryRow
                        key={item.workflowId}
                        item={item}
                        onClick={() => setSelectedHistoryItem(item)}
                      />
                    ))}
                  </div>
                )
              )}
            </section>
          </div>
        )}
      </div>

      {/* Read-only conversation drawer for history items */}
      <Sheet open={selectedHistoryItem !== null} onOpenChange={(open) => { if (!open) setSelectedHistoryItem(null); }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetTitle className="sr-only">
            {selectedHistoryItem?.taskTitle ?? t.inbox.recentlyResolved}
          </SheetTitle>
          {historyWorkflow && (
            <ConversationReplyPanel
              workflow={historyWorkflow}
              askingRoleName={selectedHistoryItem?.askingRoleName}
              onReplied={() => setSelectedHistoryItem(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Reply Drawer for blocked conversations */}
      <Sheet open={selectedItem !== null} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
          <SheetTitle className="sr-only">
            {selectedItem?.taskTitle ?? t.inbox.needsYourReply}
          </SheetTitle>
          {selectedWorkflow && (
            <ConversationReplyPanel
              workflow={selectedWorkflow}
              askingRoleName={selectedItem?.askingRoleName}
              onReplied={handleReplied}
            />
          )}
        </SheetContent>
      </Sheet>
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

/* ── History Row ────────────────────────────── */

function HistoryRow({
  item,
  onClick,
}: {
  item: ConversationInboxItem;
  onClick: () => void;
}) {
  const t = useT();

  // Determine state from waitingSince (which is updatedAt for resolved items)
  // We infer the terminal state from respondentType context — the backend could provide this,
  // but for now we show a generic "resolved" style. The timeline Sheet shows full details.
  return (
    <div
      className="group flex items-start gap-3 rounded-lg border border-border/50 p-3 transition-colors cursor-pointer hover:bg-accent/50 opacity-75 hover:opacity-100"
      onClick={onClick}
    >
      <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground truncate">{item.taskTitle}</p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{item.askingRoleName} → {item.respondentType === 'human' ? 'You' : (item.respondentRoleName ?? '?')}</span>
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
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <ArrowRight size={14} />
      </Button>
    </div>
  );
}
