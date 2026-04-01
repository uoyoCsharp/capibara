import { useState, useEffect, useCallback } from 'react';
import { ArrowClockwise, Lightning, CurrencyDollar, ListChecks, ChartLineUp } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import type { NarrativeRecord, CostSummaryRecord, CostEntryRecord, RoleRecord } from '@shared/contracts';

declare const window: Window & { capibara: import('@shared/contracts').CapibaraApi };

interface DashboardPageProps {
  orgId: string | null;
}

export function DashboardPage({ orgId }: DashboardPageProps) {
  const [narrative, setNarrative] = useState<NarrativeRecord | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummaryRecord | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [narRes, costRes, rolesRes] = await Promise.all([
        window.capibara.getNarrative(orgId),
        window.capibara.getCostSummary(orgId),
        window.capibara.getRolesByOrgId(orgId),
      ]);
      if (narRes.ok) setNarrative(narRes.data);
      if (costRes.ok) setCostSummary(costRes.data);
      if (rolesRes.ok) setRoles(rolesRes.data);
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
    } finally {
      setGenerating(false);
    }
  };

  if (!orgId) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-500">
          Select an organization to view the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Lightning size={14} />
            {generating ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {/* Budget bar */}
      {costSummary && <BudgetBar summary={costSummary} />}

      {/* Narrative */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ListChecks size={20} className="text-indigo-500" />
          <h2 className="text-lg font-medium text-gray-800">Project Progress</h2>
          {narrative && (
            <span className="ml-auto text-xs text-gray-400">
              Generated: {new Date(narrative.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
        {narrative ? (
          <div className="prose prose-sm max-w-none text-gray-700">
            <NarrativeContent text={narrative.renderedText} />
          </div>
        ) : (
          <p className="text-sm text-gray-400 leading-relaxed">
            No narrative generated yet. Click "Generate Report" to create a project status report.
          </p>
        )}
      </div>

      {/* Cost breakdown */}
      {costSummary && costSummary.entries.length > 0 && (
        <CostBreakdown entries={costSummary.entries} roles={roles} />
      )}
    </div>
  );
}

function BudgetBar({ summary }: { summary: CostSummaryRecord }) {
  const { totalCost, budgetLimit, budgetPercent } = summary;
  const barColor =
    budgetPercent >= 95 ? 'bg-red-500' :
    budgetPercent >= 80 ? 'bg-amber-500' :
    'bg-green-500';
  const textColor =
    budgetPercent >= 95 ? 'text-red-700' :
    budgetPercent >= 80 ? 'text-amber-700' :
    'text-green-700';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CurrencyDollar size={18} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Budget Usage</span>
        </div>
        <span className={clsx('text-sm font-semibold', textColor)}>
          ${totalCost.toFixed(2)} / ${budgetLimit.toFixed(2)} ({budgetPercent}%)
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2.5">
        <div
          className={clsx('h-2.5 rounded-full transition-all', barColor)}
          style={{ width: `${Math.min(budgetPercent, 100)}%` }}
        />
      </div>
      {budgetPercent >= 80 && (
        <p className={clsx('text-xs mt-1.5', textColor)}>
          {budgetPercent >= 95 ? '⚠️ Budget critical — execution paused' : '⚠️ Approaching budget limit'}
        </p>
      )}
    </div>
  );
}

function CostBreakdown({ entries, roles }: { entries: CostEntryRecord[]; roles: RoleRecord[] }) {
  // Group by role
  const byRole = new Map<string, { name: string; total: number; count: number }>();
  for (const e of entries) {
    const existing = byRole.get(e.roleId) ?? {
      name: roles.find((r) => r.id === e.roleId)?.name ?? 'Unknown',
      total: 0,
      count: 0,
    };
    existing.total += e.costUsd;
    existing.count += 1;
    byRole.set(e.roleId, existing);
  }

  const sorted = [...byRole.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <ChartLineUp size={20} className="text-indigo-500" />
        <h2 className="text-lg font-medium text-gray-800">Cost by Role</h2>
      </div>
      <div className="space-y-3">
        {sorted.map(([roleId, data]) => {
          const totalCost = entries.reduce((sum, e) => sum + e.costUsd, 0);
          const pct = totalCost > 0 ? Math.round((data.total / totalCost) * 100) : 0;
          return (
            <div key={roleId}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-700">{data.name}</span>
                <span className="text-xs text-gray-500">
                  ${data.total.toFixed(2)} ({data.count} runs)
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-indigo-400 h-1.5 rounded-full transition-all"
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

function NarrativeContent({ text }: { text: string }) {
  // Simple markdown-to-JSX rendering for the narrative
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return <h2 key={i} className="text-lg font-semibold text-gray-900 mt-4 mb-1">{line.slice(3)}</h2>;
        }
        if (line.startsWith('### ')) {
          return <h3 key={i} className="text-base font-semibold text-gray-800 mt-3 mb-1">{line.slice(4)}</h3>;
        }
        if (line.startsWith('- ')) {
          return <li key={i} className="text-sm text-gray-700 ml-4 list-disc">{renderBold(line.slice(2))}</li>;
        }
        if (line.trim() === '') {
          return <div key={i} className="h-1" />;
        }
        return <p key={i} className="text-sm text-gray-700">{renderBold(line)}</p>;
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
