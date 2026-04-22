import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ChatCircleDots, ArrowBendUpLeft, CheckCircle, XCircle, CircleNotch } from '@phosphor-icons/react';
import { MarkdownContent } from '../ui/markdown-content';
import { useConversationStore } from '../../store/conversation.store';
import { useOrganizationStore } from '../../store/organization.store';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import type { ConversationRecord, ConversationMessageRecord, RoleRecord, DesktopEvent } from '@core/shared/types';

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

const TYPE_LABELS: Record<string, string> = {
  inquiry: 'Inquiry',
  planning: 'Planning',
  adhoc: 'Chat',
};

function roleName(id: string | null, roles: RoleRecord[]): string {
  if (!id) return 'Human';
  return roles.find((r) => r.id === id)?.name ?? id.slice(0, 8);
}

export function InboxPage({ orgId }: InboxPageProps) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = () => window.capibara as any;

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

  const active = conversations.filter((c) => ['active', 'waiting', 'escalated'].includes(c.state));
  const resolved = conversations.filter((c) => ['resolved', 'completed', 'cancelled', 'timed_out'].includes(c.state));

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <ChatCircleDots size={48} weight="duotone" />
        <p>Select an organization to view conversations</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-80 border-r border-border overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Inbox</h2>
          <p className="text-xs text-muted-foreground">{active.length} active</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {active.map((conv) => (
              <ConversationItem key={conv.id} conv={conv} roles={roles} selected={conv.id === selectedId} onSelect={setSelectedId} />
            ))}
            {resolved.length > 0 && (
              <>
                <div className="px-4 py-2 text-xs text-muted-foreground font-medium bg-muted/50">Resolved ({resolved.length})</div>
                {resolved.map((conv) => (
                  <ConversationItem key={conv.id} conv={conv} roles={roles} selected={conv.id === selectedId} onSelect={setSelectedId} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${STATE_COLORS[selected.state] ?? ''}`}>{selected.state}</span>
                  <span className="text-xs text-muted-foreground">{TYPE_LABELS[selected.type]}</span>
                </div>
                <p className="text-sm mt-1">
                  {roleName(selected.initiatorRoleId, roles)} → {roleName(selected.respondentRoleId, roles)}
                </p>
              </div>
              <div className="flex gap-2">
                {['active', 'waiting', 'escalated'].includes(selected.state) && (
                  <>
                    <button onClick={() => void resolveConv(selected.id)} className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-600 hover:bg-green-500/20">
                      <CheckCircle size={14} className="inline mr-1" />Resolve
                    </button>
                    <button onClick={() => void cancelConv(selected.id)} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-600 hover:bg-red-500/20">
                      <XCircle size={14} className="inline mr-1" />Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} roles={roles} />
              ))}
            </div>

            {['active', 'waiting'].includes(selected.state) && selected.respondentType === 'human' && (
              <div className="border-t border-border">
                {isWaitingAI && (
                  <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/30">
                    <CircleNotch size={14} className="animate-spin" />
                    <span>AI is processing your reply...</span>
                  </div>
                )}
                <div className="p-4 flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isSending && !isWaitingAI && void handleReply()}
                    placeholder={isWaitingAI ? 'Waiting for AI response...' : 'Type your reply...'}
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
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <ChatCircleDots size={48} weight="duotone" />
            <p>Select a conversation to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationItem({ conv, roles, selected, onSelect }: { conv: ConversationRecord; roles: RoleRecord[]; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(conv.id)}
      className={`w-full text-left p-3 hover:bg-accent/50 transition-colors ${selected ? 'bg-accent' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs px-1.5 py-0.5 rounded ${STATE_COLORS[conv.state] ?? ''}`}>{conv.state}</span>
        <span className="text-xs text-muted-foreground">{TYPE_LABELS[conv.type]}</span>
      </div>
      <p className="text-sm truncate">{roleName(conv.initiatorRoleId, roles)} → {roleName(conv.respondentRoleId, roles)}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{new Date(conv.createdAt).toLocaleString()}</p>
    </button>
  );
}

function MessageBubble({ msg, roles }: { msg: ConversationMessageRecord; roles: RoleRecord[] }) {
  const isHuman = msg.authorType === 'human';
  return (
    <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] rounded-lg px-3 py-2 ${
        isHuman ? 'bg-primary text-primary-foreground' :
        msg.authorType === 'system' ? 'bg-muted text-muted-foreground italic' :
        'bg-accent'
      }`}>
        <p className="text-xs font-medium mb-0.5 opacity-70">
          {msg.authorType === 'system' ? 'System' : roleName(msg.authorRoleId, roles)}
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
