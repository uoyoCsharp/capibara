import { useState, useEffect, useRef, useCallback } from 'react';
import {
  PaperPlaneRight,
  CircleNotch,
  ArrowDown,
  X,
  CaretUpDown,
} from '@phosphor-icons/react';
import type {
  SectionId,
  DesktopEvent,
  ActivePlanningSessionRecord,
  DiscussionMessageRecord,
  PendingPlanRecord,
  PlanningRoleOption,
} from '@shared/contracts';
import { cn } from '../../lib/utils';
import { useCapibaraSnapshot } from '../../hooks/useCapibaraSnapshot';
import { useT } from '../../hooks/useLocale';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { MarkdownContent } from '../shared/MarkdownContent';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { PhaseIndicator, type PlanningPhase } from './PhaseIndicator';
import { TypingIndicator } from './TypingIndicator';
import { PlanPreview } from './PlanPreview';

declare const window: Window & { capibara: import('@shared/contracts').CapibaraApi };

interface PlanningChatPageProps {
  onNavigate?: (section: SectionId) => void;
}

interface ChatMessage {
  id: string;
  authorType: 'human' | 'ai';
  authorName: string;
  content: string;
  createdAt: string;
}

type PageView = 'welcome' | 'chat' | 'plan-preview';

export function PlanningChatPage({ onNavigate }: PlanningChatPageProps) {
  const { currentOrgId } = useCapibaraSnapshot();
  const t = useT();

  // Core state
  const [view, setView] = useState<PageView>('welcome');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Session state
  const [session, setSession] = useState<ActivePlanningSessionRecord | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlanRecord | null>(null);
  const [currentPhase, setCurrentPhase] = useState<PlanningPhase>('diverge');

  // Role state
  const [planningRoles, setPlanningRoles] = useState<PlanningRoleOption[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Refs
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // ── Load available planning roles ──────────────────────────
  useEffect(() => {
    if (!currentOrgId) return;
    window.capibara.getAvailablePlanningRoles(currentOrgId).then((res) => {
      if (res.ok) {
        setPlanningRoles(res.data);
        if (res.data.length > 0 && !selectedRoleId) {
          // Default to template role if available, otherwise system role
          const template = res.data.find((r) => r.source === 'template');
          setSelectedRoleId(template?.roleId ?? res.data[0].roleId);
        }
      }
    }).catch(() => {});
  }, [currentOrgId]);

  // ── Load active session on mount ──────────────────────────
  const loadSession = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const [sessionRes, planRes] = await Promise.all([
        window.capibara.getActivePlanningSession(currentOrgId),
        window.capibara.getPendingPlan(currentOrgId),
      ]);

      if (planRes.ok && planRes.data) {
        setPendingPlan(planRes.data);
        setView('plan-preview');
        return;
      }

      if (sessionRes.ok && sessionRes.data) {
        setSession(sessionRes.data);
        setView('chat');
        // Load conversation history
        if (sessionRes.data.discussionGroupId) {
          await loadMessages(sessionRes.data.discussionGroupId);
        }
        // Determine AI thinking state:
        // - waiting_for_reply → AI done, user can reply
        // - null → no active workflow (run may have finished or not started conversation)
        // - other (reply_received, resumed) → AI is processing
        if (sessionRes.data.workflowState === 'waiting_for_reply' || sessionRes.data.workflowState === null) {
          setIsAiThinking(false);
        } else {
          setIsAiThinking(true);
          setThinkingStartedAt(Date.now());
        }
      }
    } catch {
      // No active session — stay on welcome
    }
  }, [currentOrgId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // ── Load discussion messages ──────────────────────────────
  const loadMessages = useCallback(async (groupId: string) => {
    try {
      const res = await window.capibara.getDiscussionMessages(groupId);
      if (res.ok) {
        const roleName = sessionRef.current?.roleName ?? 'Planning Agent';
        const mapped: ChatMessage[] = res.data.map((m: DiscussionMessageRecord) => ({
          id: m.id,
          authorType: m.authorType === 'human' ? 'human' as const : 'ai' as const,
          authorName: m.authorType === 'human' ? 'You' : roleName,
          content: m.content,
          createdAt: m.createdAt,
        }));
        setMessages(mapped);
      }
    } catch { /* silent */ }
  }, []);

  const reloadSession = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await window.capibara.getActivePlanningSession(currentOrgId);
      if (res.ok && res.data) {
        setSession(res.data);
        if (res.data.discussionGroupId) {
          await loadMessages(res.data.discussionGroupId);
        }
        if (res.data.workflowState === 'waiting_for_reply') {
          setIsAiThinking(false);
          setThinkingStartedAt(null);
        }
      } else if (res.ok && !res.data) {
        // Session ended (e.g., task reached terminal status)
        setIsAiThinking(false);
        setThinkingStartedAt(null);
      }
    } catch {
      // On error, reset thinking state to avoid indefinite spinner
      setIsAiThinking(false);
      setThinkingStartedAt(null);
    }
  }, [currentOrgId, loadMessages]);

  const loadPendingPlan = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await window.capibara.getPendingPlan(currentOrgId);
      if (res.ok && res.data) {
        setPendingPlan(res.data);
        setView('plan-preview');
      }
    } catch { /* silent */ }
  }, [currentOrgId]);

  // ── Subscribe to events ───────────────────────────────────
  useEffect(() => {
    if (!currentOrgId) return;
    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      const s = sessionRef.current;
      // New message in discussion
      if (event.type === 'discussion:message-added' && s?.discussionGroupId) {
        if (event.groupId === s.discussionGroupId) {
          loadMessages(s.discussionGroupId);
        }
      }
      // Run completed — AI done thinking
      if (event.type === 'run:completed' && s) {
        setIsAiThinking(false);
        setThinkingStartedAt(null);
        if (event.status === 'failed') {
          toast.error(t.runs.failed);
        } else if (event.status === 'cancelled') {
          toast.info(t.runs.cancelled);
        }
        // Reload session to get updated workflow state
        reloadSession();
      }
      // Run started — AI thinking
      if (event.type === 'run:changed' && s) {
        // Reload to detect if AI is thinking
        reloadSession();
      }
      // Plan ready
      if (event.type === 'planning:plan-ready' && event.orgId === currentOrgId) {
        loadPendingPlan();
      }
      // Conversation events
      if (
        (event.type === 'conversation:question-posted' || event.type === 'conversation:reply-posted') &&
        event.orgId === currentOrgId
      ) {
        reloadSession();
      }
    });
    return unsub;
  }, [currentOrgId, t, loadMessages, reloadSession, loadPendingPlan]);

  // ── Elapsed timer ─────────────────────────────────────────
  useEffect(() => {
    if (!isAiThinking || !thinkingStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - thinkingStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isAiThinking, thinkingStartedAt]);

  // ── Auto-scroll ───────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiThinking]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollButton(!isNearBottom);
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── Phase detection based on conversation round count ─────
  // Mirrors backend detectPlanningPhase heuristic (run count based).
  // AI messages count as conversation rounds.
  useEffect(() => {
    const aiMessageCount = messages.filter((m) => m.authorType === 'ai').length;
    if (aiMessageCount >= 4) {
      setCurrentPhase('structure');
    } else if (aiMessageCount >= 2) {
      setCurrentPhase('focus');
    } else {
      setCurrentPhase('diverge');
    }
  }, [messages]);

  // ── Start planning ────────────────────────────────────────
  const handleStartPlanning = async () => {
    if (!currentOrgId || !inputValue.trim()) return;
    setIsSending(true);
    try {
      const res = await window.capibara.startPlanningRun({
        orgId: currentOrgId,
        initialMessage: inputValue.trim(),
        ...(selectedRoleId ? { roleId: selectedRoleId } : {}),
      });
      if (!res.ok) {
        toast.error(`${t.planning.failedToStartPlanning}: ${res.error.message}`);
        return;
      }
      // Add user message to chat
      setMessages([{
        id: `user-${Date.now()}`,
        authorType: 'human',
        authorName: 'You',
        content: inputValue.trim(),
        createdAt: new Date().toISOString(),
      }]);
      setInputValue('');
      setView('chat');
      setIsAiThinking(true);
      setThinkingStartedAt(Date.now());
      // Reload session to get the full session data
      setTimeout(() => { reloadSession().catch(() => {}); }, 1000);
    } catch {
      toast.error(t.planning.failedToStartPlanning);
    } finally {
      setIsSending(false);
    }
  };

  // ── Send reply ────────────────────────────────────────────
  const handleSendReply = async () => {
    if (!session?.workflowId || !inputValue.trim()) return;
    setIsSending(true);
    try {
      const res = await window.capibara.replyToConversation({
        workflowId: session.workflowId,
        content: inputValue.trim(),
      });
      if (!res.ok) {
        toast.error(t.conversations.replyFailed);
        return;
      }
      // Add user message immediately
      setMessages((prev) => [...prev, {
        id: `user-${Date.now()}`,
        authorType: 'human',
        authorName: 'You',
        content: inputValue.trim(),
        createdAt: new Date().toISOString(),
      }]);
      setInputValue('');
      setIsAiThinking(true);
      setThinkingStartedAt(Date.now());
    } catch {
      toast.error(t.conversations.replyFailed);
    } finally {
      setIsSending(false);
    }
  };

  // ── Handle send (start or reply) ──────────────────────────
  const handleSend = () => {
    if (view === 'welcome') {
      handleStartPlanning();
    } else {
      handleSendReply();
    }
  };

  // ── Handle key press ──────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Switch planning role ────────────────────────────────
  const handleSwitchRole = async (newRoleId: string) => {
    if (!session?.taskId || isAiThinking) return;
    try {
      const res = await window.capibara.switchPlanningRole({ taskId: session.taskId, newRoleId });
      if (res.ok) {
        setSelectedRoleId(newRoleId);
        await reloadSession();
      } else {
        toast.error(res.error.message);
      }
    } catch {
      toast.error(t.errors.failedToUpdate);
    }
  };

  // ── Start over (discard plan and return to welcome) ──────
  const handleStartOver = async () => {
    if (session?.taskId) {
      try {
        await window.capibara.discardPlanningSession({ taskId: session.taskId });
      } catch { /* best effort */ }
    }
    setSession(null);
    setMessages([]);
    setPendingPlan(null);
    setView('welcome');
    setIsAiThinking(false);
    setCurrentPhase('diverge');
  };

  // ── Cancel session ────────────────────────────────────────
  const handleCancelSession = async () => {
    if (!session?.taskId) return;
    setShowCancelDialog(false);
    try {
      await window.capibara.discardPlanningSession({ taskId: session.taskId });
      setSession(null);
      setMessages([]);
      setView('welcome');
      setIsAiThinking(false);
      setCurrentPhase('diverge');
      onNavigate?.('dashboard');
    } catch {
      toast.error(t.errors.failedToUpdate);
    }
  };

  // ── Input state ───────────────────────────────────────────
  const isInputDisabled = isAiThinking || isSending;
  const placeholder = isAiThinking
    ? t.planning.inputPlaceholderThinking
    : view === 'welcome'
      ? t.planning.inputPlaceholder
      : t.planning.inputPlaceholderReply;

  // ── No org selected ───────────────────────────────────────
  if (!currentOrgId) {
    return (
      <div className="flex h-full items-center justify-center p-(--page-padding)">
        <p className="text-muted-foreground text-sm">{t.planning.startNewProjectTooltip}</p>
      </div>
    );
  }

  // ── Plan Preview ──────────────────────────────────────────
  if (view === 'plan-preview' && pendingPlan) {
    return (
      <PlanPreview
        plan={pendingPlan}
        onPlanChange={setPendingPlan}
        onConfirm={() => {/* handled inside PlanPreview */}}
        onStartOver={handleStartOver}
        onNavigate={onNavigate}
      />
    );
  }

  // ── Main Chat UI ──────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t.planning.planningChat}</h1>
          <p className="text-xs text-muted-foreground">{t.planning.planningChatSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {view === 'chat' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCancelDialog(true)}
              className="text-muted-foreground"
            >
              <X size={14} className="mr-1" />
              {t.planning.cancelSession}
            </Button>
          )}
        </div>
      </div>

      {/* Role Selector + Phase Indicator */}
      {view === 'chat' && (
        <div className="border-b px-6 py-2.5 flex items-center justify-between">
          <PhaseIndicator currentPhase={currentPhase} />
          {planningRoles.length > 1 && (
            <RoleSelector
              roles={planningRoles}
              selectedRoleId={session?.roleId ?? selectedRoleId}
              disabled={isAiThinking}
              onSwitch={handleSwitchRole}
            />
          )}
        </div>
      )}
      {/* Role Selector on welcome page */}
      {view === 'welcome' && planningRoles.length > 1 && (
        <div className="border-b px-6 py-2.5 flex justify-end">
          <RoleSelector
            roles={planningRoles}
            selectedRoleId={selectedRoleId}
            disabled={false}
            onSwitch={(id) => setSelectedRoleId(id)}
          />
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto px-6 py-4"
      >
        {view === 'welcome' ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="max-w-md text-center">
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {t.planning.planningChat}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {t.planning.emptyStateCta}
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            {isAiThinking && (
              <div className="flex items-start gap-3">
                <Avatar className="w-7 h-7 shrink-0">
                  <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                    {(session?.roleName ?? 'AI').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2 py-2">
                  <TypingIndicator />
                  {elapsedSeconds >= 30 && (
                    <span className="text-xs text-muted-foreground">
                      {t.planning.thinkingElapsed.replace('{seconds}', String(elapsedSeconds))}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && view === 'chat' && (
        <div className="relative">
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full bg-primary/10 border p-1.5 shadow-sm hover:bg-primary/20 transition-colors"
          >
            <ArrowDown size={16} className="text-primary" />
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isInputDisabled}
            rows={2}
            className="resize-none flex-1 text-sm"
          />
          <Button
            onClick={handleSend}
            disabled={isInputDisabled || !inputValue.trim()}
            className="self-end"
          >
            {isSending ? (
              <CircleNotch size={16} className="animate-spin" />
            ) : (
              <PaperPlaneRight size={16} />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 text-center">
          Ctrl+Enter to send
        </p>
      </div>

      {/* Cancel dialog */}
      {showCancelDialog && (
        <ConfirmDialog
          title={t.planning.cancelConfirm}
          message={t.planning.cancelConfirmMessage}
          confirmLabel={t.common.confirm}
          cancelLabel={t.common.cancel}
          variant="warning"
          onConfirm={handleCancelSession}
          onCancel={() => setShowCancelDialog(false)}
        />
      )}
    </div>
  );
}

// ── Chat Bubble Component ───────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.authorType === 'human';

  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <Avatar className="w-7 h-7 shrink-0">
        <AvatarFallback
          className={cn(
            'text-xs font-bold text-primary-foreground',
            isUser ? 'bg-green-500' : 'bg-primary',
          )}
        >
          {isUser ? 'H' : message.authorName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-medium text-foreground">{message.authorName}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <div
          className={cn(
            'rounded-lg px-3 py-2 max-w-[85%]',
            isUser
              ? 'bg-primary/10 text-foreground'
              : 'bg-muted text-foreground',
          )}
        >
          <MarkdownContent content={message.content} className="text-sm break-words" />
        </div>
      </div>
    </div>
  );
}

// ── Role Selector Component ─────────────────────────────────

function RoleSelector({
  roles,
  selectedRoleId,
  disabled,
  onSwitch,
}: {
  roles: PlanningRoleOption[];
  selectedRoleId: string | null;
  disabled: boolean;
  onSwitch: (roleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = roles.find((r) => r.roleId === selectedRoleId) ?? roles[0];

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          disabled
            ? 'text-muted-foreground/50 cursor-not-allowed'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <span>{selected?.roleName ?? 'Select role'}</span>
        <CaretUpDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border bg-popover p-1 shadow-lg z-50">
          {roles.map((role) => (
            <button
              key={role.roleId}
              type="button"
              onClick={() => {
                onSwitch(role.roleId);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors',
                role.roleId === selectedRoleId && 'bg-accent',
              )}
            >
              <span>{role.roleName}</span>
              <span className="text-[10px] text-muted-foreground/60">{role.source}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
