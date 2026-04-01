import { useState, useEffect, useRef, useCallback } from 'react';
import type { DesktopEvent } from '@shared/contracts';

const MAX_LOG_LENGTH = 50000;

/**
 * Subscribes to run:log events for a specific runId and accumulates log output.
 * Returns the accumulated log string and a ref for auto-scroll.
 */
export function useRunLogs(runId: string | null) {
  const [log, setLog] = useState('');
  const scrollRef = useRef<HTMLPreElement>(null);

  const appendLog = useCallback((chunk: string) => {
    setLog((prev) => {
      const next = prev + chunk;
      return next.length > MAX_LOG_LENGTH
        ? next.slice(next.length - MAX_LOG_LENGTH)
        : next;
    });
  }, []);

  useEffect(() => {
    if (!runId) {
      setLog('');
      return;
    }

    if (typeof window.capibara?.subscribe !== 'function') return;

    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (event.type === 'run:log' && event.runId === runId) {
        appendLog(event.chunk);
      }
    });

    return unsub;
  }, [runId, appendLog]);

  // Auto-scroll to bottom when log updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  return { log, scrollRef };
}
