import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { CircleNotch, CheckCircle, XCircle, Clock, Terminal, FolderOpen } from '@phosphor-icons/react';
import type { RunRecord } from '@core/shared/types';
import { useRunLogs } from '../../hooks/use-run-logs';
import { Badge } from '../ui/badge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

const MAX_DISPLAY_LINES = 500;
const TRUNCATION_KEEP_HEAD = 50;
const TRUNCATION_KEEP_TAIL = 400;

interface RunOutputPanelProps {
  taskId: string;
}

export function RunOutputPanel({ taskId }: RunOutputPanelProps) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [historicLogs, setHistoricLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
  const isRunning = selectedRun?.status === 'running' || selectedRun?.status === 'queued';

  const { entries, assistantText } = useRunLogs(isRunning ? selectedRunId : null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api().getRunsByTaskId(taskId).then((res: { ok: boolean; data?: RunRecord[] }) => {
      if (res.ok && res.data) {
        setRuns(res.data);
        if (res.data.length > 0) {
          setSelectedRunId(res.data[0].id);
        }
      }
    });
  }, [taskId]);

  useEffect(() => {
    if (!selectedRunId || isRunning) {
      setHistoricLogs([]);
      return;
    }
    setLoadingLogs(true);
    api().getRunLogs(selectedRunId).then((res: { ok: boolean; data?: string[] }) => {
      if (res.ok && res.data) setHistoricLogs(res.data);
      setLoadingLogs(false);
    }).catch(() => setLoadingLogs(false));
  }, [selectedRunId, isRunning]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, historicLogs]);

  const truncatedHistoricLogs = useMemo(() => {
    if (historicLogs.length <= MAX_DISPLAY_LINES) {
      return { head: historicLogs, tail: [], skipped: 0 };
    }
    return {
      head: historicLogs.slice(0, TRUNCATION_KEEP_HEAD),
      tail: historicLogs.slice(-TRUNCATION_KEEP_TAIL),
      skipped: historicLogs.length - TRUNCATION_KEEP_HEAD - TRUNCATION_KEEP_TAIL,
    };
  }, [historicLogs]);

  const handleOpenLogDir = useCallback(async () => {
    if (!selectedRunId) return;
    const res = await api().getRunLogDir(selectedRunId);
    if (res.ok && res.data) {
      await api().openFolder(res.data);
    }
  }, [selectedRunId]);

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <Terminal size={32} weight="duotone" />
        <p className="text-sm">No runs yet for this task.</p>
      </div>
    );
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'succeeded': return <CheckCircle size={14} className="text-green-500" weight="fill" />;
      case 'failed': return <XCircle size={14} className="text-red-500" weight="fill" />;
      case 'running': return <CircleNotch size={14} className="text-blue-500 animate-spin" />;
      case 'queued': return <Clock size={14} className="text-yellow-500" />;
      default: return <Clock size={14} className="text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Run selector */}
      {runs.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {runs.map((run, idx) => (
            <button
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                run.id === selectedRunId
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {statusIcon(run.status)}
              Run #{runs.length - idx}
            </button>
          ))}
        </div>
      )}

      {/* Run summary */}
      {selectedRun && (
        <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {statusIcon(selectedRun.status)}
              <span className="text-sm font-medium capitalize">{selectedRun.status}</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedRun.tokenCount > 0 && (
                <Badge variant="secondary" className="text-xs">{selectedRun.tokenCount} tokens</Badge>
              )}
              {selectedRun.startedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(selectedRun.startedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {selectedRun.summary && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Summary</p>
              <p className="text-sm whitespace-pre-wrap">{selectedRun.summary}</p>
            </div>
          )}

          {selectedRun.errorMessage && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-red-500 uppercase tracking-wider">Error</p>
              <p className="text-sm text-red-600 whitespace-pre-wrap">{selectedRun.errorMessage}</p>
            </div>
          )}
        </div>
      )}

      {/* Real-time assistant text (while running) */}
      {isRunning && assistantText && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">AI Output</p>
          <div className="rounded-lg border border-border bg-background p-3 max-h-[300px] overflow-auto">
            <pre className="text-sm whitespace-pre-wrap font-mono">{assistantText}</pre>
          </div>
        </div>
      )}

      {/* Log output */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Terminal size={12} />
            Execution Log
            {!isRunning && historicLogs.length > MAX_DISPLAY_LINES && (
              <span className="font-normal normal-case">({historicLogs.length} lines)</span>
            )}
          </p>
          {selectedRunId && (
            <button
              onClick={handleOpenLogDir}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Open log directory"
            >
              <FolderOpen size={12} />
              Open Logs
            </button>
          )}
        </div>
        <div className="rounded-lg border border-border bg-zinc-950 p-3 max-h-[400px] overflow-auto font-mono text-xs">
          {loadingLogs && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <CircleNotch size={12} className="animate-spin" /> Loading...
            </div>
          )}

          {/* Historic logs (for completed runs) — truncated */}
          {!isRunning && truncatedHistoricLogs.head.length > 0 && (
            <>
              {truncatedHistoricLogs.head.map((line, i) => (
                <LogLine key={i} raw={line} />
              ))}
              {truncatedHistoricLogs.skipped > 0 && (
                <div className="text-zinc-500 py-1 my-1 border-y border-zinc-800 text-center">
                  ... {truncatedHistoricLogs.skipped} lines truncated — open log file for full output ...
                </div>
              )}
              {truncatedHistoricLogs.tail.map((line, i) => (
                <LogLine key={`tail-${i}`} raw={line} />
              ))}
            </>
          )}

          {/* Real-time logs (for running) — show latest entries */}
          {isRunning && entries.map((entry, i) => (
            <div key={i} className={entry.stream === 'stderr' ? 'text-red-400' : 'text-green-300'}>
              {entry.chunk}
            </div>
          ))}

          {!loadingLogs && !isRunning && historicLogs.length === 0 && (
            <span className="text-zinc-500">No log output recorded.</span>
          )}

          {isRunning && entries.length === 0 && (
            <span className="text-zinc-500 flex items-center gap-2">
              <CircleNotch size={12} className="animate-spin" /> Waiting for output...
            </span>
          )}

          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

function LogLine({ raw }: { raw: string }) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === 'input') {
      return (
        <div className="text-blue-300 mb-1">
          <span className="text-zinc-500">[{parsed.ts?.split('T')[1]?.slice(0, 8) ?? ''}] </span>
          <span className="text-blue-400">PROMPT</span>{' '}
          <span className="text-zinc-400">role={parsed.roleId} reason={parsed.wakeReason}</span>
        </div>
      );
    }
    return <div className="text-green-300 mb-0.5">{raw}</div>;
  } catch {
    const trimmed = raw.length > 2000 ? raw.slice(0, 2000) + '...[truncated]' : raw;
    return <div className="text-green-300 mb-0.5">{trimmed}</div>;
  }
}
