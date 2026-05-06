import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ChatCircleDots, ArrowBendUpLeft, CheckCircle, XCircle, CircleNotch, TreeStructure } from '@phosphor-icons/react';
import { MarkdownContent } from '../ui/markdown-content';
import { useConversationStore } from '../../store/conversation.store';
import { useOrganizationStore } from '../../store/organization.store';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import { useT } from '../../hooks/use-locale';
import type { LocaleMessages } from '@shared/locale/types';
import type { ConversationRecord, ConversationMessageRecord, RoleRecord, DesktopEvent } from '@core/shared/types';
import { PlanTreeReview } from '../planning/PlanTreeReview';
import { usePlanTreeStore } from '../../store/plan-tree.store';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

interface InboxPageProps {
  orgId: string | null;
}

const STATE_COLORS: Record<string, string> = {
  active: 'bg-blue-500/10 text-blue-600',
  waiting: 'bg-yellow-500/10 text-yellow-600',
  resolved: 'bg-green-500/10 text-green-600',
  escalated: 'bg-orange-500/10 text-orange-600',
  timed_out: 'bg-red-500/10 text-red-600',
  cancelled: 'bg-muted text-muted-foreground',
  completed: 'bg-green-500/10 text-green-600',
};

function typeLabel(type: string, t: LocaleMessages): string {
  switch (type) {
    case 'inquiry': return t.inbox.types.inquiry;
    case 'planning': return t.inbox.types.planning;
    case 'adhoc': return t.inbox.types.adhoc;
    case 'plan_review': return t.inbox.types.planReview;
    default: return type;
  }
}

function roleName(id: string | null, roles: RoleRecord[], humanFallback: string): string {
  if (!id) return humanFallback;
  return roles.find((r) => r.id === id)?.name ?? id.slice(0, 8);
}

export function InboxPage({ orgId }: InboxPageProps) {
  const t = useT();
  const conversations = useConversationStore((s) => s.conversations);
  const messages = useConversationStore((s) => s.messages);
  const isLoading = useConversationStore((s) => s.isLoading);
  const loadConversations = useConversationStore((s) => s.loadConversations);
  const loadMessages = useConversationStore((s) => s.loadMessages);
  const resolveConv = useConversationStore((s) => s.resolve);
  const cancelConv = useConversationStore((s) => s.cancel);
  const selectedId = useConversationStore((s) => s.selectedConversationId);
  const setSelectedId = useConversationStore((s) => s.setSelectedConversationId);

  const roles = useOrganizationStore((s) => s.roles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);

  const waitingAIIds = useConversationStore((s) => s.waitingAIConversationIds);
  const markWaitingAI = useConversationStore((s) => s.markWaitingAI);
  const clearWaitingAI = useConversationStore((s) => s.clearWaitingAI);

  const isWaitingAI = selectedId ? waitingAIIds.has(selectedId) : false;

  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    if (orgId) {
      void loadConversations(orgId);
      void loadRoles(orgId);
    }
  }, [orgId, loadConversations, loadRoles]);

  useEffect(() => {
    if (selectedId) {
      prevMessageCountRef.current = 0;
      setReplyText('');
      void loadMessages(selectedId);
    }
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!messagesContainerRef.current || messages.length === 0) return;
    if (prevMessageCountRef.current === 0) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    } else if (messages.length > prevMessageCountRef.current) {
      messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  const conversationEventTypes = useMemo<DesktopEvent['type'][]>(() => ['conversation:changed', 'conversation:response-needed'], []);
  useEventSubscription(conversationEventTypes, useCallback(() => {
    if (orgId) void loadConversations(orgId);
    if (selectedId) void loadMessages(selectedId);
  }, [orgId, selectedId, loadConversations, loadMessages]));

  const runEventTypes = useMemo<DesktopEvent['type'][]>(() => ['run:completed'], []);
  useEventSubscription(runEventTypes, useCallback(() => {
    for (const id of useConversationStore.getState().waitingAIConversationIds) {
      clearWaitingAI(id);
    }
    if (orgId) void loadConversations(orgId);
    if (selectedId) void loadMessages(selectedId);
  }, [orgId, selectedId, loadConversations, loadMessages, clearWaitingAI]));

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const api = () => window.capibara;

  const handleReply = useCallback(async () => {
    if (!selectedId || !replyText.trim() || isSending) return;
    setIsSending(true);
    try {
      await api().addConversationMessage({
        conversationId: selectedId,
        authorRoleId: null,
        authorType: 'human',
        content: replyText.trim(),
        intent: 'reply',
      });
      setReplyText('');
      markWaitingAI(selectedId);
      await loadMessages(selectedId);
    } finally {
      setIsSending(false);
    }
  }, [selectedId, replyText, isSending, loadMessages, markWaitingAI]);

  const { blocked, monitoring, resolved } = partitionConversations(conversations);

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <ChatCircleDots size={48} weight="duotone" />
        <p>{t.inbox.noOrgSelected}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-80 border-r border-border overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">{t.inbox.title}</h2>
          <p className="text-xs text-muted-foreground">
            {interpolate(t.inbox.summary, { blocked: blocked.length, monitoring: monitoring.length })}
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            <SectionLabel title={t.inbox.blockedSection} count={blocked.length} tone="warning" />
            {blocked.map((conv) => (
              <ConversationItem key={conv.id} conv={conv} roles={roles} t={t} selected={conv.id === selectedId} onSelect={setSelectedId} />
            ))}

            <SectionLabel title={t.inbox.monitoringSection} count={monitoring.length} tone="info" />
            {monitoring.map((conv) => (
              <ConversationItem key={conv.id} conv={conv} roles={roles} t={t} selected={conv.id === selectedId} onSelect={setSelectedId} />
            ))}

            {resolved.length > 0 && (
              <>
                <SectionLabel title={t.inbox.resolvedSection} count={resolved.length} tone="neutral" />
                {resolved.map((conv) => (
                  <ConversationItem key={conv.id} conv={conv} roles={roles} t={t} selected={conv.id === selectedId} onSelect={setSelectedId} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {selected ? (
          selected.type === 'plan_review' ? (
            <InboxPlanReviewPanel conversation={selected} roles={roles} t={t} />
          ) : (
          <>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${STATE_COLORS[selected.state] ?? ''}`}>{selected.state}</span>
                  <span className="text-xs text-muted-foreground">{typeLabel(selected.type, t)}</span>
                </div>
                <p className="text-sm mt-1">
                  {roleName(selected.initiatorRoleId, roles, t.inbox.humanFallback)} → {roleName(selected.respondentRoleId, roles, t.inbox.humanFallback)}
                </p>
              </div>
              <div className="flex gap-2">
                {['active', 'waiting', 'escalated'].includes(selected.state) && (
                  <>
                    <button onClick={() => void resolveConv(selected.id)} className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-600 hover:bg-green-500/20">
                      <CheckCircle size={14} className="inline mr-1" />{t.inbox.resolve}
                    </button>
                    <button onClick={() => void cancelConv(selected.id)} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-600 hover:bg-red-500/20">
                      <XCircle size={14} className="inline mr-1" />{t.inbox.cancelConversation}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} roles={roles} t={t} />
              ))}
            </div>

            {['active', 'waiting'].includes(selected.state) && selected.respondentType === 'human' && (
              <div className="border-t border-border">
                {isWaitingAI && (
                  <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/30">
                    <CircleNotch size={14} className="animate-spin" />
                    <span>{t.inbox.aiProcessing}</span>
                  </div>
                )}
                <div className="p-4 flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isSending && !isWaitingAI && void handleReply()}
                    placeholder={isWaitingAI ? t.inbox.waitingForAIPlaceholder : t.inbox.replyPlaceholder}
                    disabled={isSending || isWaitingAI}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={() => void handleReply()}
                    disabled={!replyText.trim() || isSending || isWaitingAI}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {isSending ? <CircleNotch size={16} className="animate-spin" /> : <ArrowBendUpLeft size={16} />}
                  </button>
                </div>
              </div>
            )}
          </>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <ChatCircleDots size={48} weight="duotone" />
            <p>{t.inbox.noConversationSelected}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pure partition: Blocked = AI asking human; Monitoring = AI↔AI in progress. */
export function partitionConversations(all: ConversationRecord[]): {
  blocked: ConversationRecord[];
  monitoring: ConversationRecord[];
  resolved: ConversationRecord[];
} {
  const blocked: ConversationRecord[] = [];
  const monitoring: ConversationRecord[] = [];
  const resolved: ConversationRecord[] = [];

  for (const c of all) {
    // Planning conversations have their own dedicated page (PlanningPage).
    // They should never surface in the Inbox — Inbox is for task-anchored
    // conversations only (inquiries, adhoc, plan_review).
    if (c.type === 'planning') continue;

    if (['resolved', 'completed', 'cancelled', 'timed_out'].includes(c.state)) {
      resolved.push(c);
      continue;
    }
    if (!['active', 'waiting', 'escalated'].includes(c.state)) continue;

    if (c.respondentType === 'human' || c.type === 'adhoc' || c.type === 'plan_review') {
      blocked.push(c);
    } else {
      monitoring.push(c);
    }
  }
  return { blocked, monitoring, resolved };
}

function InboxPlanReviewPanel({ conversation, roles, t }: { conversation: ConversationRecord; roles: RoleRecord[]; t: LocaleMessages }) {
  const rootTaskId = (conversation.metadata as { rootTaskId?: string }).rootTaskId;
  const loadPlanTree = usePlanTreeStore((s) => s.loadPlanTree);
  const pending = usePlanTreeStore((s) => rootTaskId ? s.byRootTaskId[rootTaskId] ?? null : null);
  const loading = usePlanTreeStore((s) => rootTaskId ? s.loading[rootTaskId] ?? false : false);

  useEffect(() => {
    if (rootTaskId) void loadPlanTree(rootTaskId);
  }, [rootTaskId, loadPlanTree]);

  if (!rootTaskId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <TreeStructure size={48} weight="duotone" />
        <p>{t.inbox.planReviewMissingRoot}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <CircleNotch size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pending) {
    const isTerminal = ['completed', 'cancelled', 'resolved'].includes(conversation.state);
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <TreeStructure size={48} weight="duotone" />
        <p>{isTerminal ? t.inbox.planReviewCompleted : t.inbox.planReviewNoTree}</p>
      </div>
    );
  }

  return (
    <PlanTreeReview
      pending={pending}
      roles={roles}
      typeLabel={(name) => typeLabel(name, t)}
    />
  );
}

function SectionLabel({ title, count, tone }: { title: string; count: number; tone: 'warning' | 'info' | 'neutral' }) {
  if (count === 0) return null;
  const toneClass =
    tone === 'warning' ? 'text-amber-700 dark:text-amber-400' :
    tone === 'info' ? 'text-blue-700 dark:text-blue-400' :
    'text-muted-foreground';
  return (
    <div className={`px-4 py-2 text-xs font-medium bg-muted/50 ${toneClass}`}>
      {title} ({count})
    </div>
  );
}

function ConversationItem({ conv, roles, t, selected, onSelect }: { conv: ConversationRecord; roles: RoleRecord[]; t: LocaleMessages; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(conv.id)}
      className={`w-full text-left p-3 hover:bg-accent/50 transition-colors ${selected ? 'bg-accent' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs px-1.5 py-0.5 rounded ${STATE_COLORS[conv.state] ?? ''}`}>{conv.state}</span>
        <span className="text-xs text-muted-foreground">{typeLabel(conv.type, t)}</span>
      </div>
      <p className="text-sm truncate">{roleName(conv.initiatorRoleId, roles, t.inbox.humanFallback)} → {roleName(conv.respondentRoleId, roles, t.inbox.humanFallback)}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{new Date(conv.createdAt).toLocaleString()}</p>
    </button>
  );
}

function MessageBubble({ msg, roles, t }: { msg: ConversationMessageRecord; roles: RoleRecord[]; t: LocaleMessages }) {
  const isHuman = msg.authorType === 'human';
  return (
    <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-lg px-3 py-2 ${
        isHuman ? 'bg-primary text-primary-foreground' :
        msg.authorType === 'system' ? 'bg-muted text-muted-foreground italic' :
        'bg-accent'
      }`}>
        <p className="text-xs font-medium mb-0.5 opacity-70">
          {msg.authorType === 'system' ? t.inbox.systemAuthor : roleName(msg.authorRoleId, roles, t.inbox.humanFallback)}
        </p>
        {isHuman ? (
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <MarkdownContent content={msg.content} />
        )}
      </div>
    </div>
  );
}
