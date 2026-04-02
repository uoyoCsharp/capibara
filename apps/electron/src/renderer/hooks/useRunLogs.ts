import { useState, useEffect, useRef, useCallback } from 'react';
import type { DesktopEvent, RunLogEntry } from '@shared/contracts';

const MAX_ENTRIES = 2000;

/**
 * Parse a single stream-json line into a user-friendly entry.
 * Only extracts 'system' (init) and 'result' — these are the only entries
 * meaningful to end users. Everything else is available in raw view.
 */
function parseStreamJsonLine(line: string): RunLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = typeof obj.type === 'string' ? obj.type : '';

  if (type === 'system') {
    const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';
    if (subtype === 'init') {
      const model = typeof obj.model === 'string' ? obj.model : 'unknown';
      return { ts: null, kind: 'system', text: `Session initialized — model: ${model}` };
    }
    return null;
  }

  if (type === 'result') {
    const result = typeof obj.result === 'string' ? obj.result : '';
    const inputTokens = typeof obj.total_input_tokens === 'number' ? obj.total_input_tokens as number : 0;
    const outputTokens = typeof obj.total_output_tokens === 'number' ? obj.total_output_tokens as number : 0;
    const totalTokens = inputTokens + outputTokens;
    const tokens = totalTokens > 0 ? `${(totalTokens / 1_000_000).toFixed(4)}M tokens` : '';
    const isError = obj.is_error === true;
    const prefix = isError ? '[Error] ' : '[Summary] ';
    return { ts: null, kind: 'result', text: `${prefix}${result}${tokens ? ` (${tokens})` : ''}` };
  }

  return null;
}

/**
 * Subscribes to run:log events for a specific runId and accumulates parsed log entries.
 * Returns both parsed entries and raw lines for the dual-view component.
 */
export function useRunLogs(runId: string | null) {
  const [entries, setEntries] = useState<RunLogEntry[]>([]);
  const [rawLog, setRawLog] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Buffer for incomplete lines split across chunks
  const lineBufferRef = useRef('');

  const processChunk = useCallback((chunk: string) => {
    // Append raw
    setRawLog((prev) => {
      const next = prev + chunk;
      return next.length > 200_000 ? next.slice(next.length - 200_000) : next;
    });

    // Parse JSON lines from chunk
    const text = lineBufferRef.current + chunk;
    const lines = text.split('\n');
    // Last element may be incomplete — buffer it
    lineBufferRef.current = lines.pop() ?? '';

    const newEntries: RunLogEntry[] = [];
    for (const line of lines) {
      const entry = parseStreamJsonLine(line);
      if (entry) newEntries.push(entry);
    }

    if (newEntries.length > 0) {
      setEntries((prev) => {
        const combined = [...prev, ...newEntries];
        return combined.length > MAX_ENTRIES ? combined.slice(combined.length - MAX_ENTRIES) : combined;
      });
    }
  }, []);

  useEffect(() => {
    if (!runId) {
      setEntries([]);
      setRawLog('');
      lineBufferRef.current = '';
      return;
    }

    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (event.type === 'run:log' && event.runId === runId) {
        processChunk(event.chunk);
      }
    });

    return unsub;
  }, [runId, processChunk]);

  // Auto-scroll to bottom when entries update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, rawLog]);

  return { entries, rawLog, scrollRef };
}
