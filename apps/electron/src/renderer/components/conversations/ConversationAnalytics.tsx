import { useState, useEffect, useCallback } from 'react';
import type { ConversationAnalyticsRecord, ConversationTimeRange } from '@shared/contracts';
import { useT } from '../../hooks/useLocale';
import { Button } from '../ui/button';

interface ConversationAnalyticsProps {
  orgId: string;
}

const TIME_RANGES: ConversationTimeRange[] = ['7d', '30d', 'all'];

export function ConversationAnalytics({ orgId }: ConversationAnalyticsProps) {
  const t = useT();
  const [timeRange, setTimeRange] = useState<ConversationTimeRange>('30d');
  const [analytics, setAnalytics] = useState<ConversationAnalyticsRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.capibara.getConversationAnalytics(orgId, timeRange);
      if (result.ok) {
        setAnalytics(result.data);
      } else {
        setAnalytics(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId, timeRange]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const rangeLabel = (r: ConversationTimeRange) => {
    if (r === '7d') return t.conversations.last7Days;
    if (r === '30d') return t.conversations.last30Days;
    return t.conversations.allTime;
  };

  if (isLoading && !analytics) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t.conversations.analytics}</h3>
        <div className="flex gap-1">
          {TIME_RANGES.map((r) => (
            <Button
              key={r}
              variant={timeRange === r ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setTimeRange(r)}
            >
              {rangeLabel(r)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Most Asked Roles */}
        <AnalyticsCard title={t.conversations.mostAskedRoles}>
          {analytics.mostAskedRoles.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-1">
              {analytics.mostAskedRoles.map((r) => (
                <li key={r.roleId} className="flex items-center justify-between text-xs">
                  <span className="truncate">{r.roleName}</span>
                  <span className="text-muted-foreground">{r.count} {t.conversations.questions}</span>
                </li>
              ))}
            </ul>
          )}
        </AnalyticsCard>

        {/* Slowest Responders */}
        <AnalyticsCard title={t.conversations.slowestResponders}>
          {analytics.slowestResponders.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-1">
              {analytics.slowestResponders.map((r) => (
                <li key={r.roleId} className="flex items-center justify-between text-xs">
                  <span className="truncate">{r.roleName}</span>
                  <span className="text-muted-foreground">{t.conversations.avgResponse}: {formatMs(r.avgResponseTimeMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </AnalyticsCard>

        {/* Escalation Hotspots */}
        <AnalyticsCard title={t.conversations.escalationHotspots}>
          {analytics.escalationHotspots.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-1">
              {analytics.escalationHotspots.map((h, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate">{h.fromRoleName} → {h.toRoleName}</span>
                  <span className="text-muted-foreground">{h.count} {t.conversations.escalations}</span>
                </li>
              ))}
            </ul>
          )}
        </AnalyticsCard>

        {/* Depth Distribution */}
        <AnalyticsCard title={t.conversations.depthDistribution}>
          {analytics.depthDistribution.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-1">
              {analytics.depthDistribution.map((d) => {
                const maxCount = Math.max(...analytics.depthDistribution.map((b) => b.count));
                const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                return (
                  <div key={d.depth} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-muted-foreground">{d.depth}-{t.conversations.hop}</span>
                    <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                      <div className="h-full rounded bg-primary/60" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-8 text-right text-muted-foreground">{d.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </AnalyticsCard>
      </div>

      {/* Human Interventions */}
      <div className="rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t.conversations.humanInterventions}: </span>
        <span className="font-semibold">{analytics.humanInterventionCount}</span>
      </div>
    </div>
  );
}

function AnalyticsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function EmptyState() {
  return <p className="text-xs text-muted-foreground">—</p>;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
