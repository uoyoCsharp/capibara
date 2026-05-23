import { useState, useEffect } from 'react';
import { CircleNotch, LinkBreak, ArrowsClockwise, UsersThree, ArrowRight } from '@phosphor-icons/react';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/use-locale';
import type { SuspensionRecord, SuspensionAwaitingRecord } from '@core/shared/types';
import { subscribeToEvents } from '../../lib/subscribe-to-events';

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

const api = () => window.capibara;

type SuspensionWithAwaiting = SuspensionRecord & { awaiting: SuspensionAwaitingRecord[] };

interface SessionStatusPanelProps {
  orgId: string | null;
  roleNames?: Map<string, string>;
}

export function SessionStatusPanel({ orgId, roleNames }: SessionStatusPanelProps) {
  const t = useT();
  const [suspensions, setSuspensions] = useState<SuspensionWithAwaiting[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadSuspensions = async () => {
    if (!orgId) return;
    setIsLoading(true);
    try {
      const result = await api().getActiveSuspensions(orgId);
      if (result.ok) {
        setSuspensions(result.data);
      }
    } catch { /* ignore */ }
    setIsLoading(false);
  };

  useEffect(() => {
    void loadSuspensions();
    const unsub = subscribeToEvents({
      'run:suspended': (e) => {
        if (e.orgId === orgId) void loadSuspensions();
      },
      'run:resumed': (e) => {
        if (e.orgId === orgId) void loadSuspensions();
      },
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (isLoading && suspensions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-3 text-xs">
        <CircleNotch size={12} className="animate-spin" />
      </div>
    );
  }

  if (suspensions.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
        <UsersThree size={16} weight="duotone" />
        <span className="text-xs">{t.collaboration.noActiveSuspensions}</span>
      </div>
    );
  }

  const roleName = (roleId: string) => roleNames?.get(roleId) ?? roleId.slice(0, 8);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <UsersThree size={12} />
        {t.collaboration.title}
      </p>
      <div className="space-y-2">
        {suspensions.map(s => (
          <div key={s.id} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LinkBreak size={14} className="text-amber-500" />
                <span className="text-sm font-medium">{roleName(s.roleId)}</span>
                <Badge variant="secondary" className="text-xs">
                  {format(t.collaboration.chainDepth, { n: s.chainDepth })}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {format(t.collaboration.suspendedSince, { time: new Date(s.suspendedAt).toLocaleTimeString() })}
              </span>
            </div>

            {s.awaiting.length > 0 && (
              <div className="space-y-1 ml-4">
                <span className="text-xs text-muted-foreground">{t.collaboration.waitingFor}:</span>
                {s.awaiting.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <ArrowRight size={10} className="text-muted-foreground" />
                    <span className="font-medium">{roleName(a.respondentRoleId)}</span>
                    <Badge
                      variant={a.status === 'pending' ? 'outline' : 'secondary'}
                      className="text-[10px]"
                    >
                      {a.status === 'pending' ? t.collaboration.awaitingStatus.pending : t.collaboration.awaitingStatus.resolved}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
