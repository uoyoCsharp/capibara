import { useState, useEffect, useCallback } from 'react';
import { ArrowClockwise, Lightning, Cpu, ListChecks, ChartLineUp, Tray, UsersThree, RocketLaunch } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { useT } from '../../hooks/useLocale';
import type { SectionId, NarrativeRecord, CostSummaryRecord, CostEntryRecord, RoleRecord } from '@shared/contracts';

declare const window: Window & { capibara: import('@shared/contracts').CapibaraApi; };

interface DashboardPageProps {
  orgId: string | null;
  onNavigate?: (section: SectionId) => void;
}

export function DashboardPage({ orgId, onNavigate }: DashboardPageProps) {
  const [narrative, setNarrative] = useState<NarrativeRecord | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummaryRecord | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [activeTaskCount, setActiveTaskCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const t = useT();

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [narRes, costRes, rolesRes, tasksRes, convoRes] = await Promise.all([
        window.capibara.getNarrative(orgId),
        window.capibara.getCostSummary(orgId),
        window.capibara.getRolesByOrgId(orgId),
        window.capibara.getTasksByOrgId(orgId),
        window.capibara.getGroupedConversations(orgId),
      ]);
      if (narRes.ok) setNarrative(narRes.data);
      if (costRes.ok) setCostSummary(costRes.data);
      if (rolesRes.ok) setRoles(rolesRes.data);
      if (tasksRes.ok) {
        setActiveTaskCount(tasksRes.data.filter((t) => t.status === 'in_progress' || t.status === 'blocked').length);
      }
      if (convoRes.ok) {
        setBlockedCount(convoRes.data.blocked.length);
      }
    } catch {
      toast.error(t.errors.failedToLoad);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh via IPC subscription
  useEffect(() => {
    if (!orgId) return;
    if (typeof window.capibara?.subscribe !== 'function') return;
    const unsub = window.capibara.subscribe((event) => {
      if (
        event.type === 'task:changed' ||
        event.type === 'run:changed' ||
        event.type === 'notification'
      ) {
        fetchData();
      }
    });
    return unsub;
  }, [orgId, fetchData]);

  const handleGenerate = async () => {
    if (!orgId) return;
    setGenerating(true);
    try {
      const res = await window.capibara.generateNarrative(orgId);
      if (res.ok) setNarrative(res.data);
      // Also refresh cost
      const costRes = await window.capibara.getCostSummary(orgId);
      if (costRes.ok) setCostSummary(costRes.data);
    } catch {
      toast.error(t.dashboard.failedToGenerate);
    } finally {
      setGenerating(false);
    }
  };

  if (!orgId) {
    return (
      <div className="p-(--page-padding)">
        <h1 className="text-3xl font-semibold text-foreground font-display mb-2">{t.dashboard.title}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t.dashboard.noOrgMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="p-(--page-padding) max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-foreground font-[family-name:var(--font-display)]">{t.dashboard.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t.dashboard.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} />
            {t.common.refresh}
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating}
          >
            <Lightning size={14} />
            {generating ? t.dashboard.generating : t.dashboard.generateReport}
          </Button>
          <Button
            onClick={() => onNavigate?.('planning')}
            disabled={!orgId}
            title={!orgId ? t.planning.startNewProjectTooltip : undefined}
          >
            <RocketLaunch size={14} />
            {t.planning.startNewProject}
          </Button>
        </div>
      </div>

      {/* Budget bar */}
      {costSummary && <BudgetBar summary={costSummary} />}

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card
          className={cn(
            'cursor-pointer transition-colors hover:ring-1 hover:ring-primary/30',
            onNavigate && 'hover:shadow-md',
          )}
          onClick={() => onNavigate?.('tasks')}
        >
          <CardContent className="flex items-center gap-3 py-4">
            <ListChecks size={24} className="text-primary flex-shrink-0" />
            <div>
              <p className="text-2xl font-bold text-foreground">{activeTaskCount}</p>
              <p className="text-xs text-muted-foreground">{t.dashboard.tasksInProgress}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={cn(
            'cursor-pointer transition-colors hover:ring-1 hover:ring-destructive/30',
            blockedCount > 0 && 'border-destructive/30',
            onNavigate && 'hover:shadow-md',
          )}
          onClick={() => onNavigate?.('inbox')}
        >
          <CardContent className="flex items-center gap-3 py-4">
            <Tray size={24} className={blockedCount > 0 ? 'text-destructive' : 'text-muted-foreground'} />
            <div>
              <p className={cn('text-2xl font-bold', blockedCount > 0 ? 'text-destructive' : 'text-foreground')}>{blockedCount}</p>
              <p className="text-xs text-muted-foreground">{t.dashboard.blockedConversations}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer transition-colors hover:ring-1 hover:ring-primary/30 hover:shadow-md"
          onClick={() => onNavigate?.('team')}
        >
          <CardContent className="flex items-center gap-3 py-4">
            <UsersThree size={24} className="text-primary flex-shrink-0" />
            <div>
              <p className="text-2xl font-bold text-foreground">{roles.length}</p>
              <p className="text-xs text-muted-foreground">{t.teamPage.rolesCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Narrative */}
      <Card className="mb-[var(--section-gap)]">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ListChecks size={20} className="text-primary" />
            <CardTitle className="text-lg font-medium font-[family-name:var(--font-display)]">{t.dashboard.projectProgress}</CardTitle>
            {narrative && (
              <span className="ml-auto text-xs text-muted-foreground">
                {t.dashboard.generatedAt}: {new Date(narrative.generatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {narrative ? (
            <div className="prose prose-sm max-w-none text-muted-foreground">
              <NarrativeContent text={narrative.renderedText} onNavigate={onNavigate} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.dashboard.noReportYet}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cost breakdown */}
      {costSummary && costSummary.entries.length > 0 && (
        <CostBreakdown entries={costSummary.entries} roles={roles} />
      )}
    </div>
  );
}

function BudgetBar({ summary }: { summary: CostSummaryRecord; }) {
  const t = useT();
  const { totalTokens, totalCostUsd, budgetPercent } = summary;
  const totalTokensM = totalTokens / 1_000_000;
  const textColor =
    budgetPercent >= 95 ? 'text-destructive' :
      budgetPercent >= 80 ? 'text-yellow-600' :
        'text-green-600';

  return (
    <div className="border-t border-border pt-4 pb-4 mb-[var(--section-gap)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu size={18} className="text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{t.dashboard.tokenUsage}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t.dashboard.budgetEstimatedUsd}: ${totalCostUsd.toFixed(2)}
          </span>
          <span className={cn('text-sm font-semibold', textColor)}>
            {totalTokensM.toFixed(4)}M tokens ({budgetPercent}%)
          </span>
        </div>
      </div>
      <Progress
        value={Math.min(budgetPercent, 100)}
        className={cn(
          'h-2.5',
          budgetPercent >= 95 ? '[&>div]:bg-destructive' :
            budgetPercent >= 80 ? '[&>div]:bg-yellow-500' :
              '[&>div]:bg-green-500',
        )}
      />
      {budgetPercent >= 80 && (
        <p className={cn('text-xs mt-1.5', textColor)}>
          {budgetPercent >= 95 ? t.dashboard.budgetCritical : t.dashboard.budgetApproaching}
        </p>
      )}
    </div>
  );
}

function CostBreakdown({ entries, roles }: { entries: CostEntryRecord[]; roles: RoleRecord[]; }) {
  const t = useT();
  // Group by role
  const byRole = new Map<string, { name: string; totalTokens: number; count: number; }>();
  for (const e of entries) {
    const existing = byRole.get(e.roleId) ?? {
      name: roles.find((r) => r.id === e.roleId)?.name ?? t.common.unknown,
      totalTokens: 0,
      count: 0,
    };
    existing.totalTokens += e.tokenCount;
    existing.count += 1;
    byRole.set(e.roleId, existing);
  }

  const sorted = [...byRole.entries()].sort((a, b) => b[1].totalTokens - a[1].totalTokens);

  return (
    <div className="bg-muted rounded-[var(--card-radius)] p-[var(--card-padding)] mb-[var(--section-gap)]">
      <div className="flex items-center gap-2 mb-4">
        <ChartLineUp size={20} className="text-primary" />
        <h2 className="text-lg font-medium text-foreground font-[family-name:var(--font-display)]">{t.dashboard.tokensByRole}</h2>
      </div>
      <div className="space-y-3">
        {sorted.map(([roleId, data]) => {
          const totalTokens = entries.reduce((sum, e) => sum + e.tokenCount, 0);
          const pct = totalTokens > 0 ? Math.round((data.totalTokens / totalTokens) * 100) : 0;
          return (
            <div key={roleId}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">{data.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(data.totalTokens / 1_000_000).toFixed(4)}M ({data.count} {t.dashboard.runs})
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NarrativeContent({ text, onNavigate }: { text: string; onNavigate?: (section: SectionId) => void }) {
  const lines = text.split('\n');

  // Map known section headers to navigation targets (longer keys first to avoid partial matches)
  const sectionNav: [string, SectionId][] = [
    ['blocked items', 'inbox'],
    ['active work', 'tasks'],
    ['execution', 'tasks'],
    ['tasks', 'tasks'],
    ['blocked', 'inbox'],
  ];

  const getNavTarget = (heading: string): SectionId | null => {
    const lower = heading.toLowerCase().replace(/[^\w\s]/g, '').trim();
    for (const [key, target] of sectionNav) {
      if (lower.includes(key)) return target;
    }
    return null;
  };

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return <h2 key={i} className="text-lg font-semibold text-foreground mt-4 mb-1">{line.slice(3)}</h2>;
        }
        if (line.startsWith('### ')) {
          const heading = line.slice(4);
          const navTarget = getNavTarget(heading);
          if (navTarget && onNavigate) {
            return (
              <h3
                key={i}
                className="text-base font-semibold text-primary mt-3 mb-1 cursor-pointer hover:underline inline-block"
                onClick={() => onNavigate(navTarget)}
              >
                {heading} →
              </h3>
            );
          }
          return <h3 key={i} className="text-base font-semibold text-foreground mt-3 mb-1">{heading}</h3>;
        }
        if (line.startsWith('- ')) {
          return <li key={i} className="text-sm text-muted-foreground ml-4 list-disc">{renderBold(line.slice(2))}</li>;
        }
        if (line.trim() === '') {
          return <div key={i} className="h-1" />;
        }
        return <p key={i} className="text-sm text-muted-foreground">{renderBold(line)}</p>;
      })}
    </div>
  );
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}
