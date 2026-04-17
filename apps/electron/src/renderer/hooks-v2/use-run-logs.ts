import { useState, useEffect, useCallback, useRef } from 'react';
import type { DesktopEvent } from '@core/shared/types';

interface LogEntry {
  runId: string;
  stream: string;
  chunk: string;
  timestamp: number;
}

const MAX_ENTRIES = 2000;

export function useRunLogs(runId: string | null) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [assistantText, setAssistantText] = useState('');
  const entriesRef = useRef<LogEntry[]>([]);

  useEffect(() => {
    if (!runId) {
      setEntries([]);
      setAssistantText('');
      entriesRef.current = [];
      return;
    }

    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsubscribe = window.capibara.subscribe((event) => {
      const typed = event as DesktopEvent;
      if (typed.type === 'run:log' && typed.runId === runId) {
        const entry: LogEntry = { runId: typed.runId, stream: typed.stream, chunk: typed.chunk, timestamp: Date.now() };
        entriesRef.current = [...entriesRef.current.slice(-(MAX_ENTRIES - 1)), entry];
        setEntries(entriesRef.current);
      }
      if (typed.type === 'run:assistant-text' && typed.runId === runId) {
        setAssistantText((prev) => prev + typed.text);
      }
    });

    return unsubscribe;
  }, [runId]);

  const clear = useCallback(() => {
    setEntries([]);
    setAssistantText('');
    entriesRef.current = [];
  }, []);

  return { entries, assistantText, clear };
}
