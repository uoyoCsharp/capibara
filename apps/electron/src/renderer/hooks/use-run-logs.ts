import { useState, useEffect, useCallback, useRef } from 'react';
import type { DesktopEvent } from '@core/shared/types';

interface LogEntry {
  runId: string;
  stream: string;
  chunk: string;
  timestamp: number;
}

const MAX_ENTRIES = 500;
const FLUSH_INTERVAL_MS = 150;

export function useRunLogs(runId: string | null) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [assistantText, setAssistantText] = useState('');
  const entriesRef = useRef<LogEntry[]>([]);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!runId) {
      setEntries([]);
      setAssistantText('');
      entriesRef.current = [];
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (typeof window.capibara?.subscribe !== 'function') return;

    const flushEntries = () => {
      if (pendingRef.current) {
        setEntries([...entriesRef.current]);
        pendingRef.current = false;
      }
    };

    const unsubscribe = window.capibara.subscribe((event) => {
      const typed = event as DesktopEvent;
      if (typed.type === 'run:log' && typed.runId === runId) {
        const entry: LogEntry = { runId: typed.runId, stream: typed.stream, chunk: typed.chunk, timestamp: Date.now() };
        if (entriesRef.current.length >= MAX_ENTRIES) {
          entriesRef.current = entriesRef.current.slice(-Math.floor(MAX_ENTRIES * 0.8));
        }
        entriesRef.current.push(entry);
        pendingRef.current = true;
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            flushEntries();
          }, FLUSH_INTERVAL_MS);
        }
      }
      if (typed.type === 'run:assistant-text' && typed.runId === runId) {
        setAssistantText((prev) => prev + typed.text);
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runId]);

  const clear = useCallback(() => {
    setEntries([]);
    setAssistantText('');
    entriesRef.current = [];
  }, []);

  return { entries, assistantText, clear };
}
