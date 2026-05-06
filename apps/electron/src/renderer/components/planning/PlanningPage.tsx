import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, CircleNotch, Sparkle, X } from '@phosphor-icons/react';
import type { ConversationRecord, RoleRecord } from '@core/shared/types';
import { useAppStore } from '../../store/app.store';
import { useOrganizationStore } from '../../store/organization.store';
import { useWorkflowSchema } from '../../hooks/use-workflow-schema';
import { useT } from '../../hooks/use-locale';
import { toast } from '../../store/toast.store';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { PlanningAgentPicker } from './PlanningAgentPicker';
import { PlanningChat } from './PlanningChat';
import { PlanPreviewPane } from './PlanPreviewPane';

const api = () => window.capibara;

interface PlanningPageProps {
  orgId: string | null;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'pick-agent' }
  | { kind: 'awaiting-first-message'; agentRoleId: string }
  | { kind: 'chatting'; conversation: ConversationRecord }
  | { kind: 'no-org' };

export function PlanningPage({ orgId }: PlanningPageProps) {
  const t = useT();
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const roles = useOrganizationStore((s) => s.roles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);
  const { typeLabel } = useWorkflowSchema(orgId);

  const [phase, setPhase] = useState<Phase>(orgId ? { kind: 'loading' } : { kind: 'no-org' });
  const [isAIBusy, setIsAIBusy] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [hasTree, setHasTree] = useState(false);

  useEffect(() => {
    if (orgId) void loadRoles(orgId);
  }, [orgId, loadRoles]);

  // On mount / org change: look for an active planning conversation to resume.
  useEffect(() => {
    if (!orgId) {
      setPhase({ kind: 'no-org' });
      return;
    }
    setPhase({ kind: 'loading' });
    void (async () => {
      const res = await api().getActivePlanning(orgId);
      if (res.ok && res.data) {
        setPhase({ kind: 'chatting', conversation: res.data });
      } else {
        setPhase({ kind: 'pick-agent' });
      }
    })();
  }, [orgId]);

  const handleAgentChosen = useCallback((agentRoleId: string) => {
    setPhase({ kind: 'awaiting-first-message', agentRoleId });
  }, []);

  const handleFirstMessage = useCallback(async (message: string) => {
    if (!orgId || phase.kind !== 'awaiting-first-message') return;
    const agentRoleId = phase.agentRoleId;
    const res = await api().startPlanning(orgId, agentRoleId, message);
    if (res.ok) {
      setPhase({ kind: 'chatting', conversation: res.data });
      setIsAIBusy(true);
    } else {
      toast.error(res.error?.message ?? t.planning.failedToStart);
    }
  }, [orgId, phase, t]);

  const handleCancelSession = useCallback(async () => {
    if (phase.kind !== 'chatting') return;
    const res = await api().cancelConversation(phase.conversation.id);
    if (res.ok) {
      toast.info(t.planning.sessionDiscarded);
      setActiveSection('dashboard');
    } else {
      toast.error(res.error?.message ?? t.planning.failedToCancel);
    }
  }, [phase, setActiveSection, t]);

  const handleApproved = useCallback(() => {
    toast.success(t.planning.tasksCreated);
    setActiveSection('tasks');
  }, [setActiveSection, t]);

  // ── Render phases ─────────────────────────────────────────────

  if (phase.kind === 'no-org') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Sparkle size={48} weight="duotone" />
        <p>{t.planning.noOrgSelected}</p>
      </div>
    );
  }

  if (phase.kind === 'loading') {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
        <CircleNotch size={16} className="animate-spin" />
        {t.planning.loading}
      </div>
    );
  }

  if (phase.kind === 'pick-agent') {
    return (
      <>
        <EmptyState onBack={() => setActiveSection('dashboard')} label={t.planning.preparingSession} />
        <PlanningAgentPicker
          roles={roles}
          onCancel={() => setActiveSection('dashboard')}
          onConfirm={handleAgentChosen}
        />
      </>
    );
  }

  if (phase.kind === 'awaiting-first-message') {
    const agent = roles.find((r) => r.id === phase.agentRoleId);
    return (
      <FirstMessagePrompt
        agent={agent ?? null}
        onSubmit={handleFirstMessage}
        onBack={() => setActiveSection('dashboard')}
      />
    );
  }

  // phase.kind === 'chatting'
  const { conversation } = phase;
  const agent = roles.find((r) => r.id === conversation.respondentRoleId);
  const agentName = agent?.name ?? t.planning.defaultAgent;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSection('dashboard')}
            className="p-1 rounded hover:bg-accent transition-colors"
            title={t.planning.backToDashboard}
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkle size={16} weight="duotone" className="text-primary" />
            {interpolate(t.planning.withAgent, { agentName })}
          </h1>
        </div>
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 px-2 py-1 rounded hover:bg-destructive/10 transition-colors"
        >
          <X size={14} />
          {t.planning.cancelSession}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className={`${hasTree ? 'flex-[3]' : 'flex-1'} border-r border-border flex flex-col min-w-0`}>
          <PlanningChat
            conversationId={conversation.id}
            roles={roles}
            isAIBusy={isAIBusy}
            onAIBusyChange={setIsAIBusy}
          />
        </div>
        <div
          className={`${hasTree ? 'flex-[2]' : 'w-72 shrink-0'} flex flex-col min-w-0 transition-all duration-200`}
        >
          <PlanPreviewPane
            conversationId={conversation.id}
            roles={roles}
            typeLabel={typeLabel}
            onApproved={handleApproved}
            onHasTreeChange={setHasTree}
          />
        </div>
      </div>

      <Dialog open={showCancelConfirm} onOpenChange={(open) => !open && setShowCancelConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.planning.discardTitle}</DialogTitle>
            <DialogDescription>
              {t.planning.discardMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
              {t.planning.keepChatting}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowCancelConfirm(false);
                void handleCancelSession();
              }}
            >
              {t.planning.discard}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-1 rounded hover:bg-accent transition-colors"
      >
        <ArrowLeft size={18} />
      </button>
      <Sparkle size={48} weight="duotone" className="text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function FirstMessagePrompt({
  agent,
  onSubmit,
  onBack,
}: {
  agent: RoleRecord | null;
  onSubmit: (message: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const agentName = agent?.name ?? t.planning.defaultAgent;

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    await onSubmit(trimmed);
    setIsSending(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t.common.back}
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkle size={16} weight="duotone" className="text-primary" />
          {interpolate(t.planning.withAgent, { agentName })}
        </h1>
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-xl space-y-4">
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold">{t.planning.firstMessage.title}</h2>
            <p className="text-sm text-muted-foreground">
              {interpolate(t.planning.firstMessage.subtitle, { agentName })}
            </p>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                void handleSend();
              }
            }}
            placeholder={t.planning.firstMessage.placeholder}
            rows={6}
            disabled={isSending}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onBack} disabled={isSending}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void handleSend()} disabled={!message.trim() || isSending}>
              {isSending ? (
                <><CircleNotch size={14} className="mr-1.5 animate-spin" />{t.planning.firstMessage.starting}</>
              ) : (
                t.planning.firstMessage.submit
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            {t.planning.firstMessage.shortcutHint}
          </p>
        </div>
      </div>
    </div>
  );
}
