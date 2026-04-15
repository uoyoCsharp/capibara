import { useState, useEffect, useRef, useCallback } from 'react';
import {
  PaperPlaneRight,
  CircleNotch,
  ArrowDown,
  X,
  CaretUpDown,
  FolderOpen,
} from '@phosphor-icons/react';
import type {
  SectionId,
  DesktopEvent,
  SessionRecord,
  SessionMessageRecord,
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
import { useTypewriter } from '../../hooks/useTypewriter';

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

/** Format tool status for display (e.g. "tool:Skill" → "Using Skill...") */
function formatToolStatus(status: string): string {
  if (status.startsWith('tool:')) {
    const toolName = status.slice(5);
    // Prettify known tool names
    const friendly: Record<string, string> = {
      Skill: 'Loading skill...',
      ToolSearch: 'Searching tools...',
      Read: 'Reading file...',
      Glob: 'Searching files...',
      Grep: 'Searching code...',
      Bash: 'Running command...',
      Edit: 'Editing file...',
      Write: 'Writing file...',
      WebFetch: 'Fetching web content...',
      mcp__capibara__capibara_plan_tasks: 'Generating plan...',
      mcp__capibara__capibara_context: 'Loading context...',
    };
    return friendly[toolName] ?? `Using ${toolName}...`;
  }
  return status;
}

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
  const [streamingText, setStreamingText] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);

  // Session state
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlanRecord | null>(null);
  const [currentPhase, setCurrentPhase] = useState<PlanningPhase>('diverge');
  const [roleName, setRoleName] = useState<string>('AI');

  // Role state
  const [planningRoles, setPlanningRoles] = useState<PlanningRoleOption[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Typewriter effect for streaming text
  const displayedText = useTypewriter(streamingText, 4, 10);

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
          const template = res.data.find((r) => r.source === 'template');
          setSelectedRoleId(template?.roleId ?? res.data[0].roleId);
        }
      }
    }).catch(() => {});
  }, [currentOrgId]);

  // ── Load session messages ──────────────────────────────────
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await window.capibara.getSessionMessages(sessionId);
      if (res.ok) {
        const currentRoleName = roleName;
        const mapped: ChatMessage[] = res.data
          .filter((m: SessionMessageRecord) => m.authorType !== 'system')
          .map((m: SessionMessageRecord) => ({
            id: m.id,
            authorType: m.authorType === 'human' ? 'human' as const : 'ai' as const,
            authorName: m.authorType === 'human' ? 'You' : currentRoleName,
            content: m.content,
            createdAt: m.createdAt,
          }));
        setMessages(mapped);
      }
    } catch { /* silent */ }
  }, [roleName]);

  // ── Load active session on mount ──────────────────────────
  const loadSession = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const [sessionRes, planRes] = await Promise.all([
        window.capibara.getActiveSession(currentOrgId, 'planning'),
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
        // Resolve role name
        const roles = await window.capibara.getRolesByOrgId(currentOrgId);
        if (roles.ok) {
          const role = roles.data.find((r) => r.id === sessionRes.data!.roleId);
          if (role) setRoleName(role.name);
        }
        // Load messages
        await loadSessionMessages(sessionRes.data.id);
      }
    } catch {
      // No active session — stay on welcome
    }
  }, [currentOrgId, loadSessionMessages]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

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

      // Session message added — reload messages
      if (event.type === 'session:message-added' && s && event.sessionId === s.id) {
        loadSessionMessages(s.id);
      }

      // Tool status update — show what the AI is doing
      if (event.type === 'run:status' && s) {
        setToolStatus(event.status);
      }

      // Streaming assistant text — clear tool status when real text arrives
      if (event.type === 'run:assistant-text' && s) {
        setToolStatus(null);
        setStreamingText((prev) => prev + event.text);
      }

      // Session run completed — AI done thinking
      if (event.type === 'session:run-completed' && s && event.sessionId === s.id) {
        setIsAiThinking(false);
        setThinkingStartedAt(null);
        setStreamingText('');
        setToolStatus(null);
        if (event.status === 'failed') {
          toast.error(t.runs.failed);
        } else if (event.status === 'cancelled') {
          toast.info(t.runs.cancelled);
        }
        // Reload messages for final state
        loadSessionMessages(s.id);
      }

      // Session completed or cancelled externally
      if (event.type === 'session:completed' && s && event.sessionId === s.id) {
        setIsAiThinking(false);
        setThinkingStartedAt(null);
      }
      if (event.type === 'session:cancelled' && s && event.sessionId === s.id) {
        setIsAiThinking(false);
        setThinkingStartedAt(null);
        setSession(null);
        setMessages([]);
        setView('welcome');
      }

      // Plan ready
      if (event.type === 'planning:plan-ready' && event.orgId === currentOrgId) {
        loadPendingPlan();
      }
    });
    return unsub;
  }, [currentOrgId, t, loadSessionMessages, loadPendingPlan]);

  // ── Elapsed timer + thinking timeout safety net ──────────
  const THINKING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  useEffect(() => {
    if (!isAiThinking || !thinkingStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - thinkingStartedAt;
      setElapsedSeconds(Math.floor(elapsed / 1000));
      if (elapsed > THINKING_TIMEOUT_MS) {
        setIsAiThinking(false);
        setThinkingStartedAt(null);
        setStreamingText('');
        toast.error(t.runs.failed);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isAiThinking, thinkingStartedAt, t]);

  // ── Auto-scroll ───────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiThinking, displayedText]);

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
      const res = await window.capibara.startSession({
        orgId: currentOrgId,
        type: 'planning',
        roleId: selectedRoleId ?? '',
        initialMessage: inputValue.trim(),
      });
      if (!res.ok) {
        toast.error(`${t.planning.failedToStartPlanning}: ${res.error.message}`);
        return;
      }
      setSession(res.data);
      // Resolve role name
      const roles = await window.capibara.getRolesByOrgId(currentOrgId);
      if (roles.ok) {
        const role = roles.data.find((r) => r.id === res.data.roleId);
        if (role) setRoleName(role.name);
      }
      // Add user message to chat immediately
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
      setStreamingText('');
    } catch {
      toast.error(t.planning.failedToStartPlanning);
    } finally {
      setIsSending(false);
    }
  };

  // ── Send reply ────────────────────────────────────────────
  const handleSendReply = async () => {
    if (!session || !inputValue.trim()) return;
    setIsSending(true);
    try {
      const res = await window.capibara.sendSessionMessage({
        sessionId: session.id,
        message: inputValue.trim(),
      });
      if (!res.ok) {
        toast.error(t.session.failedToSend);
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
      setStreamingText('');
    } catch {
      toast.error(t.session.failedToSend);
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
    if (!session || isAiThinking) return;
    try {
      const res = await window.capibara.switchSessionRole({ sessionId: session.id, newRoleId });
      if (res.ok) {
        setSelectedRoleId(newRoleId);
        // Update role name
        const roles = await window.capibara.getRolesByOrgId(currentOrgId!);
        if (roles.ok) {
          const role = roles.data.find((r) => r.id === newRoleId);
          if (role) setRoleName(role.name);
        }
        // Update session state
        setSession((prev) => prev ? { ...prev, roleId: newRoleId } : prev);
      } else {
        toast.error(res.error.message);
      }
    } catch {
      toast.error(t.errors.failedToUpdate);
    }
  };

  // ── Start over (discard plan and return to welcome) ──────
  const handleStartOver = async () => {
    if (session) {
      try {
        await window.capibara.cancelSession({ sessionId: session.id });
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
    if (!session) return;
    setShowCancelDialog(false);
    try {
      await window.capibara.cancelSession({ sessionId: session.id });
      setSession(null);
      setMessages([]);
      setView('welcome');
      setIsAiThinking(false);
      setCurrentPhase('diverge');
      onNavigate?.('dashboard');
    } catch {
      toast.error(t.session.failedToCancel);
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
          {view === 'chat' && session && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.capibara.openSessionLogFolder(session.id).catch(() => {});
              }}
              className="text-muted-foreground"
              title={t.tasksExecution.openLogFolder}
            >
              <FolderOpen size={14} />
            </Button>
          )}
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
                    {roleName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {displayedText ? (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">{roleName}</span>
                      <span className="text-xs text-muted-foreground">{t.planning.streaming}</span>
                    </div>
                    <div className="rounded-lg px-3 py-2 max-w-[85%] bg-muted text-foreground">
                      <MarkdownContent content={displayedText} className="text-sm break-words" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 py-2">
                    <div className="flex items-center gap-2">
                      <TypingIndicator />
                      {elapsedSeconds >= 30 && (
                        <span className="text-xs text-muted-foreground">
                          {t.planning.thinkingElapsed.replace('{seconds}', String(elapsedSeconds))}
                        </span>
                      )}
                    </div>
                    {toolStatus && (
                      <span className="text-xs text-muted-foreground/70 pl-1 animate-pulse">
                        {formatToolStatus(toolStatus)}
                      </span>
                    )}
                  </div>
                )}
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
