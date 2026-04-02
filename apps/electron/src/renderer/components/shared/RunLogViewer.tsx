import { useState, useEffect, useRef, useCallback } from 'react';
import { FolderOpen } from '@phosphor-icons/react';
import type { RunLogEntry } from '@shared/contracts';
import { useRunLogs } from '../../hooks/useRunLogs';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

/** Max characters shown in the raw view before truncation */
const RAW_DISPLAY_LIMIT = 10_000;
/** Max characters for streaming raw view */
const RAW_STREAM_DISPLAY_LIMIT = 20_000;

interface RunLogViewerProps {
  runId: string;
  isActive: boolean;
  maxHeight?: string;
}

const KIND_STYLES: Record<string, string> = {
  system: 'text-blue-500',
  result: 'text-green-600',
};

const KIND_LABELS: Record<string, string> = {
  system: 'System',
  result: 'Summary',
};

export function RunLogViewer({ runId, isActive, maxHeight = 'max-h-96' }: RunLogViewerProps) {
  const t = useT();
  const [viewMode, setViewMode] = useState<'parsed' | 'raw'>('parsed');
  const [historicalEntries, setHistoricalEntries] = useState<RunLogEntry[]>([]);
  const [historicalRaw, setHistoricalRaw] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { entries: streamEntries, rawLog, scrollRef } = useRunLogs(isActive ? runId : null);

  const loadHistoricalLogs = useCallback(async () => {
    if (isActive) return;
    setIsLoading(true);
    try {
      const result = await window.capibara.getRunLog({
        runId,
        mode: viewMode,
        offset: 0,
        // For raw mode, load a limited batch; for parsed, system+result entries are few
        limit: viewMode === 'raw' ? 200 : 500,
      });
      if (result.ok) {
        if (viewMode === 'parsed') {
          setHistoricalEntries(result.data.entries);
        } else {
          setHistoricalRaw(result.data.rawLines);
        }
      }
    } catch {
      // Ignore errors
    } finally {
      setIsLoading(false);
    }
  }, [runId, isActive, viewMode]);

  useEffect(() => {
    if (!isActive) {
      setHistoricalEntries([]);
      setHistoricalRaw([]);
      void loadHistoricalLogs();
    }
  }, [runId, isActive, viewMode, loadHistoricalLogs]);

  const handleOpenFolder = () => {
    void window.capibara.openRunLogFolder(runId);
  };

  const entries = isActive ? streamEntries : historicalEntries;

  // Build truncated raw text
  let rawText: string;
  let isRawTruncated: boolean;
  if (isActive) {
    isRawTruncated = rawLog.length > RAW_STREAM_DISPLAY_LIMIT;
    rawText = isRawTruncated ? rawLog.slice(rawLog.length - RAW_STREAM_DISPLAY_LIMIT) : rawLog;
  } else {
    const joined = historicalRaw.join('\n');
    isRawTruncated = joined.length > RAW_DISPLAY_LIMIT;
    rawText = isRawTruncated ? joined.slice(0, RAW_DISPLAY_LIMIT) : joined;
  }

  const isEmpty = viewMode === 'parsed' ? entries.length === 0 : rawText.length === 0;

  return (
    <div className="space-y-2">
      {/* View mode toggle + open folder */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('parsed')}
            className={cn(
              'px-2 py-0.5 text-xs rounded-md transition-colors',
              viewMode === 'parsed'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {t.tasksExecution.parsedView}
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={cn(
              'px-2 py-0.5 text-xs rounded-md transition-colors',
              viewMode === 'raw'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {t.tasksExecution.rawView}
          </button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleOpenFolder}
          className="text-xs text-muted-foreground hover:text-foreground gap-1"
        >
          <FolderOpen size={14} />
          {t.tasksExecution.openLogFolder}
        </Button>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className={cn('bg-muted rounded-lg p-3 overflow-auto font-mono text-xs leading-relaxed', maxHeight)}
      >
        {isLoading && isEmpty && (
          <p className="text-muted-foreground">{t.tasksExecution.loadingLog}</p>
        )}

        {!isLoading && isEmpty && !isActive && (
          <p className="text-muted-foreground">{t.tasksExecution.noOutputLog}</p>
        )}

        {isActive && isEmpty && (
          <p className="text-muted-foreground">{t.tasksExecution.waitingForOutput}</p>
        )}

        {viewMode === 'parsed' ? (
          <div className="space-y-1">
            {entries.map((entry, i) => (
              <ParsedEntry key={i} entry={entry} />
            ))}
          </div>
        ) : (
          <>
            <pre className="whitespace-pre-wrap break-all">{rawText}</pre>
            {isRawTruncated && (
              <p className="mt-2 text-[10px] text-muted-foreground italic">
                {t.tasksExecution.rawTruncated}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ParsedEntry({ entry }: { entry: RunLogEntry }) {
  const style = KIND_STYLES[entry.kind] ?? 'text-muted-foreground';
  const label = KIND_LABELS[entry.kind] ?? entry.kind;

  return (
    <div className={cn('py-0.5', style)}>
      <span className="text-[10px] font-semibold uppercase opacity-60 mr-1.5">{label}</span>
      <span className="whitespace-pre-wrap break-words">{entry.text}</span>
    </div>
  );
}
