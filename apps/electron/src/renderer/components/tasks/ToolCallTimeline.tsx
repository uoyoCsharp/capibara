import { CircleNotch, CheckCircle, XCircle, Wrench } from '@phosphor-icons/react';
import type { ToolCallEntry } from '../../store/run.store';
import { useToolCalls } from '../../hooks/use-tool-calls';
import { useT } from '../../hooks/use-locale';
import type { ToolCallLogRecord } from '@core/shared/types';

interface ToolCallTimelineProps {
  runId: string | null;
  isRunning: boolean;
  historicToolCalls?: ToolCallLogRecord[];
}

export function ToolCallTimeline({ runId, isRunning, historicToolCalls }: ToolCallTimelineProps) {
  const t = useT();
  const { toolCalls: liveToolCalls } = useToolCalls(isRunning ? runId : null);

  const items: ToolCallEntry[] = isRunning
    ? liveToolCalls
    : (historicToolCalls ?? []).map(tc => ({
        toolCallId: tc.toolCallId,
        title: tc.title,
        status: tc.permission === 'rejected' ? 'rejected' : 'completed',
        kind: tc.kind,
        timestamp: new Date(tc.createdAt).getTime(),
      }));

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
        <Wrench size={16} weight="duotone" />
        <span className="text-xs">{t.toolCalls.noToolCalls}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Wrench size={12} />
        {t.toolCalls.title}
      </p>
      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border max-h-[200px] overflow-auto">
        {items.map((tc, i) => (
          <div key={tc.toolCallId + '-' + i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <ToolCallStatusIcon status={tc.status} />
            <span className="font-medium truncate flex-1" title={tc.title}>
              {tc.title || tc.toolCallId}
            </span>
            {tc.kind && (
              <span className="text-muted-foreground">{tc.kind}</span>
            )}
            <span className="text-muted-foreground tabular-nums">
              {new Date(tc.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCallStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <CircleNotch size={12} className="text-blue-500 animate-spin flex-shrink-0" />;
    case 'completed':
      return <CheckCircle size={12} className="text-green-500 flex-shrink-0" weight="fill" />;
    case 'failed':
    case 'rejected':
      return <XCircle size={12} className="text-red-500 flex-shrink-0" weight="fill" />;
    default:
      return <CircleNotch size={12} className="text-muted-foreground flex-shrink-0" />;
  }
}
