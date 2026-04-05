import { useState, useEffect } from 'react';
import { ChatCircle, ArrowsClockwise, ArrowUp, Clock, CheckCircle, ShieldWarning, Warning } from '@phosphor-icons/react';
import type { ConversationEventRecord } from '@shared/contracts';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';

interface ConversationTimelineProps {
  workflowId: string;
}

const EVENT_CONFIG: Record<string, { color: string; icon: typeof ChatCircle; labelKey: string }> = {
  question_posted: { color: 'text-blue-500 border-blue-500', icon: ChatCircle, labelKey: 'questionPosted' },
  routing_decided: { color: 'text-purple-500 border-purple-500', icon: ArrowsClockwise, labelKey: 'routingDecided' },
  reply_posted: { color: 'text-green-500 border-green-500', icon: ChatCircle, labelKey: 'replyPosted' },
  state_changed: { color: 'text-slate-500 border-slate-500', icon: ArrowsClockwise, labelKey: 'stateChanged' },
  timeout_triggered: { color: 'text-red-500 border-red-500', icon: Clock, labelKey: 'timeoutTriggered' },
  escalation_created: { color: 'text-orange-500 border-orange-500', icon: ArrowUp, labelKey: 'escalationCreated' },
  human_gate_enforced: { color: 'text-yellow-500 border-yellow-500', icon: ShieldWarning, labelKey: 'humanGateEnforced' },
  resolved: { color: 'text-green-600 border-green-600', icon: CheckCircle, labelKey: 'resolved' },
  cancelled: { color: 'text-muted-foreground border-muted-foreground', icon: Warning, labelKey: 'cancelled' },
};

export function ConversationTimeline({ workflowId }: ConversationTimelineProps) {
  const t = useT();
  const [events, setEvents] = useState<ConversationEventRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void window.capibara.getConversationEvents(workflowId).then((result) => {
      if (cancelled) return;
      if (result.ok) setEvents(result.data);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [workflowId]);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{t.conversations.timeline}</h3>

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No timeline events</p>
      ) : (
        <div className="relative space-y-0">
          {/* Vertical line */}
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />

          {events.map((ev) => {
            const config = EVENT_CONFIG[ev.eventType] ?? EVENT_CONFIG.state_changed;
            const Icon = config.icon;
            const label = (t.conversations as Record<string, string>)[config.labelKey] ?? ev.eventType;

            return (
              <div key={ev.id} className="relative flex gap-3 py-2">
                {/* Dot */}
                <div
                  className={cn(
                    'relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-background',
                    config.color,
                  )}
                >
                  <Icon className="h-3 w-3" weight="bold" />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{label}</div>
                  {renderPayload(ev)}
                  <div className="mt-0.5 text-[10px] text-muted-foreground" title={ev.createdAt}>
                    {formatRelativeTime(ev.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderPayload(ev: ConversationEventRecord) {
  const p = ev.eventPayload;
  if (!p || Object.keys(p).length === 0) return null;

  switch (ev.eventType) {
    case 'routing_decided': {
      const decision = p.decision as Record<string, unknown> | undefined;
      if (decision?.auditReason) {
        return <div className="mt-0.5 text-[11px] text-muted-foreground break-all">{String(decision.auditReason)}</div>;
      }
      return null;
    }
    case 'state_changed':
      return (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {String(p.from ?? '')} → {String(p.to ?? '')}
        </div>
      );
    case 'escalation_created':
      return (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Depth: {String(p.depth ?? '')} | Target: {String(p.escalationTarget ?? p.newRespondentRoleId ?? '')}
        </div>
      );
    case 'timeout_triggered':
      return (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {p.forcedHuman ? `Forced human: ${String(p.reason ?? '')}` : `Elapsed: ${formatMs(Number(p.elapsedMs ?? 0))}`}
        </div>
      );
    case 'human_gate_enforced':
      return (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {String(p.auditReason ?? '')}
        </div>
      );
    default:
      return null;
  }
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
