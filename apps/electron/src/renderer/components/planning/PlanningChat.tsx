import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ArrowBendUpLeft, CircleNotch, Sparkle } from '@phosphor-icons/react';
import type {
  ConversationMessageRecord,
  RoleRecord,
  DesktopEvent,
} from '@core/shared/types';
import { MarkdownContent } from '../ui/markdown-content';
import { useEventSubscription } from '../../hooks/use-event-subscription';
import { useT } from '../../hooks/use-locale';
import type { LocaleMessages } from '@shared/locale/types';
import { toast } from '../../store/toast.store';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

const api = () => window.capibara;

interface PlanningChatProps {
  conversationId: string;
  roles: RoleRecord[];
  /** When true, the respondent (AI) is processing a wake and input is disabled. */
  isAIBusy: boolean;
  onAIBusyChange: (busy: boolean) => void;
}

function roleName(id: string | null, roles: RoleRecord[], fallback: string): string {
  if (!id) return fallback;
  return roles.find((r) => r.id === id)?.name ?? id.slice(0, 8);
}

export function PlanningChat({ conversationId, roles, isAIBusy, onAIBusyChange }: PlanningChatProps) {
  const t = useT();
  const [messages, setMessages] = useState<ConversationMessageRecord[]>([]);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  const loadMessages = useCallback(async () => {
    const res = await api().getConversationMessages(conversationId);
    if (res.ok && res.data) setMessages(res.data);
  }, [conversationId]);

  useEffect(() => {
    prevMessageCountRef.current = 0;
    void loadMessages();
  }, [conversationId, loadMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!messagesContainerRef.current || messages.length === 0) return;
    if (prevMessageCountRef.current === 0) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    } else if (messages.length > prevMessageCountRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  // Hold a ref to the current busy state so the event handler can distinguish
  // "run failed while we were waiting for it" from background run noise.
  const isAIBusyRef = useRef(isAIBusy);
  useEffect(() => { isAIBusyRef.current = isAIBusy; }, [isAIBusy]);

  // Events we care about:
  //   - run:completed → AI finished (maybe with failure) → clear busy, reload
  //   - conversation:response-needed (this conversation) → AI has work to do → set busy
  //   - conversation:changed → messages may have been appended (AI's own reply) → reload
  // Surface failed/cancelled runs only when we were actively waiting.
  const runEventTypes = useMemo<DesktopEvent['type'][]>(
    () => ['run:completed', 'conversation:changed', 'conversation:response-needed'],
    [],
  );
  useEventSubscription(runEventTypes, useCallback((event) => {
    if (event.type === 'conversation:response-needed') {
      // Only flip busy on for THIS conversation (e.g. refine wake from preview pane)
      if (event.conversationId === conversationId) {
        onAIBusyChange(true);
      }
      return;
    }
    if (event.type === 'run:completed') {
      if (event.status !== 'succeeded' && isAIBusyRef.current) {
        const msg = event.status === 'failed' ? t.planningChat.failedResponse : t.planningChat.cancelled;
        toast.error(msg);
      }
      void loadMessages();
      onAIBusyChange(false);
      return;
    }
    // conversation:changed
    void loadMessages();
  }, [conversationId, loadMessages, onAIBusyChange, t]));

  const handleSend = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed || isSending || isAIBusy) return;
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
  }, [conversationId, replyText, isSending, isAIBusy, loadMessages, onAIBusyChange]);

  return (
    <div className="flex h-full flex-col">
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t.planningChat.startingConversation}
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} roles={roles} t={t} />)
        )}
        {isAIBusy && <TypingIndicator t={t} />}
      </div>

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
    </div>
  );
}

/**
 * Richer waiting indicator: animated bouncing dots + elapsed time so user
 * knows the system is alive during long AI runs.
 */
function TypingIndicator({ t }: { t: LocaleMessages }) {
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(Date.now());

  useEffect(() => {
    startedRef.current = Date.now();
    setElapsed(0);
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="flex justify-start">
      <div className="bg-accent rounded-lg px-3 py-2 flex items-start gap-2 min-w-0">
        <Sparkle size={14} weight="duotone" className="text-primary mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium opacity-70">{t.planningChat.aiBusyLabel}</span>
            <span className="flex items-center gap-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {elapsed > 3
              ? interpolate(t.planningChat.thinkingWithTime, { seconds: elapsed })
              : t.planningChat.thinking}
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, roles, t }: { msg: ConversationMessageRecord; roles: RoleRecord[]; t: LocaleMessages }) {
  const isHuman = msg.authorType === 'human';
  return (
    <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
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
