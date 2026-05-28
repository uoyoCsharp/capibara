import { CircleNotch, CheckCircle, XCircle } from '@phosphor-icons/react';
import type { ToolCallEvent } from '../../hooks/use-tool-calls';
import { useT } from '../../hooks/use-locale';

interface ToolCallListProps {
  toolCalls: ToolCallEvent[];
}

export function ToolCallList({ toolCalls }: ToolCallListProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 divide-y divide-border/50 max-h-[200px] overflow-auto">
      {toolCalls.map((tc, i) => (
        <ToolCallRow key={tc.toolCallId + '-' + i} tc={tc} />
      ))}
    </div>
  );
}

function ToolCallRow({ tc }: { tc: ToolCallEvent }) {
  const t = useT();
  const statusLabel = (() => {
    switch (tc.status) {
      case 'running': return t.planningChat.progressToolCallStatus.running;
      case 'completed': return t.planningChat.progressToolCallStatus.completed;
      case 'failed':
      case 'rejected': return t.planningChat.progressToolCallStatus.failed;
      default: return tc.status;
    }
  })();

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
      <ToolCallStatusIcon status={tc.status} />
      <span className="font-medium truncate flex-1" title={tc.title}>
        {tc.title || tc.toolCallId}
      </span>
      <span className="text-muted-foreground shrink-0">{statusLabel}</span>
    </div>
  );
}

function ToolCallStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <CircleNotch size={12} className="text-blue-500 animate-spin shrink-0" />;
    case 'completed':
      return <CheckCircle size={12} className="text-green-500 shrink-0" weight="fill" />;
    case 'failed':
    case 'rejected':
      return <XCircle size={12} className="text-red-500 shrink-0" weight="fill" />;
    default:
      return <CircleNotch size={12} className="text-muted-foreground shrink-0" />;
  }
}
