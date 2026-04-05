import { useState, useEffect, useCallback } from 'react';
import type { DesktopEvent, ConversationWorkflowRecord, ConversationMetricsRecord } from '@shared/contracts';
import { useCapibaraSnapshot } from '../../hooks/useCapibaraSnapshot';
import { useT } from '../../hooks/useLocale';
import { toast } from '../../store/toast.store';
import { ConversationList } from './ConversationList';
import { ConversationTimeline } from './ConversationTimeline';
import { ConversationAnalytics } from './ConversationAnalytics';

export function ConversationPage() {
  const { currentOrgId } = useCapibaraSnapshot();
  const t = useT();

  const [conversations, setConversations] = useState<ConversationWorkflowRecord[]>([]);
  const [metrics, setMetrics] = useState<ConversationMetricsRecord | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async (orgId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setIsLoading(true);

    const convPromise = window.capibara.getActiveConversations(orgId);
    const metricsPromise = window.capibara.getConversationMetrics(orgId);

    try {
      const convResult = await convPromise;
      if (convResult.ok) setConversations(convResult.data);
      else toast.error(t.conversations.failedToLoad);
    } catch {
      toast.error(t.conversations.failedToLoad);
    } finally {
      if (!silent) setIsLoading(false);
    }

    try {
      const metricsResult = await metricsPromise;
      if (metricsResult.ok) setMetrics(metricsResult.data);
    } catch {
      // Keep existing metrics if this refresh fails
    }
  }, [t.conversations.failedToLoad]);

  useEffect(() => {
    if (!currentOrgId) return;
    void loadData(currentOrgId);
  }, [currentOrgId, loadData]);

  // Auto-refresh on conversation events
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function' || !currentOrgId) return;

    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (
        (event.type === 'conversation:question-posted' ||
          event.type === 'conversation:resolved' ||
          event.type === 'conversation:cancelled' ||
          event.type === 'conversation:timed-out' ||
          event.type === 'conversation:escalated') &&
        (event as Record<string, unknown>).orgId === currentOrgId
      ) {
        void loadData(currentOrgId, { silent: true });
      }
    });

    return unsub;
  }, [currentOrgId, loadData]);

  const handleCancel = async (workflowId: string) => {
    const result = await window.capibara.cancelConversation({ workflowId });
    if (result.ok) {
      toast.success(t.conversations.cancelSuccess);
      if (currentOrgId) void loadData(currentOrgId);
    } else {
      toast.error(t.conversations.failedToCancel);
    }
  };

  if (!currentOrgId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{t.conversations.noOrgMessage}</p>
      </div>
    );
  }

  const filteredConversations = showResolved
    ? conversations
    : conversations.filter((c) => !['resolved', 'timed_out', 'cancelled'].includes(c.state));

  return (
    <div className="flex h-full flex-col p-[var(--page-padding)]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold font-[family-name:var(--font-display)]">
          {t.conversations.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t.conversations.subtitle}</p>
      </div>

      {/* Metrics bar */}
      {metrics && (
        <div className="mb-4 flex flex-wrap gap-3">
          <MetricCard label={t.conversations.totalConversations} value={metrics.totalConversations} />
          <MetricCard label={t.conversations.active} value={metrics.activeConversations} />
          <MetricCard label={t.conversations.escalationRate} value={`${metrics.escalationRate}%`} />
          <MetricCard label={t.conversations.timeoutRate} value={`${metrics.timeoutRate}%`} />
          <MetricCard label={t.conversations.humanInterventionRate} value={`${metrics.humanInterventionRate}%`} />
          <MetricCard label={t.conversations.avgDepth} value={metrics.avgDepth} />
          <MetricCard label={t.conversations.cycleDetections} value={metrics.cycleDetectionCount} />
          {metrics.avgResponseTimeMs != null && (
            <MetricCard label={t.conversations.avgResponseTime} value={formatDuration(metrics.avgResponseTimeMs)} />
          )}
        </div>
      )}

      {/* Analytics */}
      {currentOrgId && (
        <div className="mb-4">
          <ConversationAnalytics orgId={currentOrgId} />
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <ConversationList
            conversations={filteredConversations}
            isLoading={isLoading}
            showResolved={showResolved}
            onToggleResolved={() => setShowResolved((v) => !v)}
            selectedId={selectedWorkflowId}
            onSelect={setSelectedWorkflowId}
            onCancel={handleCancel}
          />
        </div>

        {selectedWorkflowId && (
          <div className="w-[400px] shrink-0 overflow-auto border-l pl-4">
            <ConversationTimeline workflowId={selectedWorkflowId} />
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
