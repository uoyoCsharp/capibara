import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ArrowBendUpLeft, CircleNotch } from '@phosphor-icons/react';
import type {
  ConversationMessageRecord,
  RoleRecord,
  DesktopEvent,
} from '@core/shared/types';
import { MarkdownContent } from '../ui/markdown-content';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import { useToolCalls } from '../../hooks/use-tool-calls';
import { useConversationStore } from '../../store/conversation.store';
import { ProgressPhaseIndicator } from './ProgressPhaseIndicator';
import { useT } from '../../hooks/use-locale';
import type { LocaleMessages } from '@shared/locale/types';
import { toast } from '../../store/toast.store';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

const api = () => window.capibara;

const CROSSFADE_MS = 300;

interface PlanningChatProps {
  conversationId: string;
  roles: RoleRecord[];
  /** When true, the respondent (AI) is processing a wake and input is disabled. */
  isAIBusy: boolean;
  onAIBusyChange: (busy: boolean) => void;
  /** When true, the conversation is in a terminal state — history is shown but the composer is disabled. */
  readOnly?: boolean;
}

function roleName(id: string | null, roles: RoleRecord[], fallback: string): string {
  if (!id) return fallback;
  return roles.find((r) => r.id === id)?.name ?? id.slice(0, 8);
}

export function PlanningChat({ conversationId, roles, isAIBusy, onAIBusyChange, readOnly = false }: PlanningChatProps) {
  const t = useT();
  const getCachedMessages = useConversationStore((s) => s.getCachedMessages);
  // Seed from the rehydration cache so re-entering a conversation paints its history
  // immediately, with no empty-then-fill flicker (REQ-P4, BR-13).
  const [messages, setMessages] = useState<ConversationMessageRecord[]>(
    () => getCachedMessages(conversationId),
  );
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [fadingInMsgId, setFadingInMsgId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { toolCalls } = useToolCalls(isAIBusy ? activeRunId : null);

  const setCachedMessages = useConversationStore((s) => s.setCachedMessages);
  const loadMessages = useCallback(async () => {
    const res = await api().getConversationMessages(conversationId);
    if (res.ok && res.data) {
      setMessages(res.data);
      // Mirror into the store cache so a later re-entry can rehydrate without a flicker.
      setCachedMessages(conversationId, res.data);
    }
  }, [conversationId, setCachedMessages]);

  useEffect(() => {
    prevMessageCountRef.current = 0;
    setStreamingText('');
    setActiveRunId(null);
    setTransitioning(false);
    setFadingOut(false);
    setFadingInMsgId(null);
    setElapsedSeconds(0);
    // Re-seed from cache synchronously on conversation switch, then refresh from disk.
    setMessages(getCachedMessages(conversationId));
    void loadMessages();
  }, [conversationId, loadMessages, getCachedMessages]);

  // Elapsed time counter: runs while AI is busy
  useEffect(() => {
    if (isAIBusy) {
      setElapsedSeconds(0);
      const start = Date.now();
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else if (!transitioning) {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      setElapsedSeconds(0);
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [isAIBusy, transitioning]);

  // Auto-scroll on new messages or streaming text change
  useEffect(() => {
    if (!messagesContainerRef.current) return;
    if (messages.length === 0 && !streamingText) return;
    if (prevMessageCountRef.current === 0) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    } else if (messages.length > prevMessageCountRef.current || streamingText) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, streamingText]);

  const isAIBusyRef = useRef(isAIBusy);
  useEffect(() => { isAIBusyRef.current = isAIBusy; }, [isAIBusy]);

  const activeRunIdRef = useRef(activeRunId);
  useEffect(() => { activeRunIdRef.current = activeRunId; }, [activeRunId]);

  const runEventTypes = useMemo<DesktopEvent['type'][]>(
    () => ['run:completed', 'run:changed', 'run:assistant-text', 'run:tool-call', 'conversation:changed', 'conversation:response-needed'],
    [],
  );
  useEventSubscription(runEventTypes, useCallback((event) => {
    if (event.type === 'conversation:response-needed') {
      if (event.conversationId === conversationId) {
        onAIBusyChange(true);
      }
      return;
    }
    if (event.type === 'run:changed') {
      return;
    }
    if (event.type === 'run:assistant-text') {
      if (isAIBusyRef.current) {
        if (!activeRunIdRef.current) setActiveRunId(event.runId);
        setStreamingText((prev) => prev + event.text);
      }
      return;
    }
    if (event.type === 'run:tool-call') {
      // Handled by useToolCalls hook via its own subscription
      return;
    }
    if (event.type === 'run:completed') {
      if (event.status !== 'succeeded' && isAIBusyRef.current) {
        const msg = event.status === 'failed' ? t.planningChat.failedResponse : t.planningChat.cancelled;
        toast.error(msg);
        setStreamingText('');
        setActiveRunId(null);
        setTransitioning(false);
        setFadingOut(false);
        setFadingInMsgId(null);
        onAIBusyChange(false);
        return;
      }
      // Load-then-transition: fetch persisted messages first, then crossfade
      void loadMessages().then(() => {
        // New messages are now in state; start crossfade
        setTransitioning(true);
        setFadingOut(true);
        onAIBusyChange(false);
      }).catch(() => {
        // Fallback: skip crossfade on load failure
        setStreamingText('');
        setActiveRunId(null);
        onAIBusyChange(false);
      });
      return;
    }
    // conversation:changed
    void loadMessages();
  }, [conversationId, loadMessages, onAIBusyChange, t]));

  // Crossfade cleanup: after animation completes, clear progress state
  useEffect(() => {
    if (!transitioning) return;
    const timer = setTimeout(() => {
      setStreamingText('');
      setActiveRunId(null);
      setTransitioning(false);
      setFadingOut(false);
      setFadingInMsgId(null);
    }, CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [transitioning]);

  // Detect the newest AI message for fade-in (the one added during transition)
  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => { prevMsgCountRef.current = messages.length; });
  useEffect(() => {
    if (transitioning && messages.length > prevMsgCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.authorType === 'ai') {
        setFadingInMsgId(lastMsg.id);
      }
    }
  }, [messages, transitioning]);

  const handleSend = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed || isSending || isAIBusy || readOnly) return;
    setIsSending(true);
    try {
      await api().addConversationMessage({
        conversationId,
        authorRoleId: null,
        authorType: 'human',
        content: trimmed,
        intent: 'reply',
      });
      setReplyText('');
      onAIBusyChange(true);
      await loadMessages();
    } finally {
      setIsSending(false);
    }
  }, [conversationId, replyText, isSending, isAIBusy, readOnly, loadMessages, onAIBusyChange]);

  const showProgress = isAIBusy || transitioning;

  return (
    <div className="flex h-full flex-col">
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !streamingText ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t.planningChat.startingConversation}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                roles={roles}
                t={t}
                fadeOut={false}
                fadeIn={fadingInMsgId === msg.id}
              />
            ))}
            {showProgress && (
              <ProgressPhaseIndicator
                toolCalls={toolCalls}
                streamingText={streamingText}
                elapsedSeconds={elapsedSeconds}
                fadingOut={fadingOut}
              />
            )}
          </>
        )}
      </div>

      {readOnly ? (
        <div className="border-t border-border p-4 text-center text-xs text-muted-foreground">
          {t.planningChat.readOnlyNotice}
        </div>
      ) : (
        <div className="border-t border-border p-4 flex gap-2">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isSending && !isAIBusy && void handleSend()}
            placeholder={isAIBusy ? t.planningChat.thinkingPlaceholder : t.planningChat.inputPlaceholder}
            disabled={isSending || isAIBusy}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!replyText.trim() || isSending || isAIBusy}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSending ? <CircleNotch size={16} className="animate-spin" /> : <ArrowBendUpLeft size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  roles,
  t,
  fadeOut,
  fadeIn,
}: {
  msg: ConversationMessageRecord;
  roles: RoleRecord[];
  t: LocaleMessages;
  fadeOut: boolean;
  fadeIn: boolean;
}) {
  const isHuman = msg.authorType === 'human';
  const animClass = fadeIn ? 'planning-fade-in' : fadeOut ? 'planning-fade-out' : '';
  return (
    <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'} ${animClass}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isHuman
            ? 'bg-primary text-primary-foreground'
            : msg.authorType === 'system'
            ? 'bg-muted text-muted-foreground italic'
            : 'bg-accent'
        }`}
      >
        <p className="text-xs font-medium mb-0.5 opacity-70">
          {msg.authorType === 'system' ? t.planningChat.system : roleName(msg.authorRoleId, roles, t.planningChat.you)}
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
