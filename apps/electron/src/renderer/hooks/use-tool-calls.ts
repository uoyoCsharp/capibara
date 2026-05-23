import { useState, useEffect, useCallback, useRef } from 'react';
import type { DesktopEvent } from '@core/shared/types';

export interface ToolCallEvent {
  toolCallId: string;
  title: string;
  status: string;
  kind: string | null;
  timestamp: number;
}

const FLUSH_INTERVAL_MS = 200;

export function useToolCalls(runId: string | null) {
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const toolCallsRef = useRef<ToolCallEvent[]>([]);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!runId) {
      setToolCalls([]);
      toolCallsRef.current = [];
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (typeof window.capibara?.subscribe !== 'function') return;

    const flushToolCalls = () => {
      if (pendingRef.current) {
        setToolCalls([...toolCallsRef.current]);
        pendingRef.current = false;
      }
    };

    const unsubscribe = window.capibara.subscribe((event) => {
      const typed = event as DesktopEvent;
      if (typed.type === 'run:tool-call' && typed.runId === runId) {
        const existing = toolCallsRef.current.findIndex(tc => tc.toolCallId === typed.toolCallId);
        if (existing >= 0) {
          toolCallsRef.current[existing] = { ...toolCallsRef.current[existing], status: typed.status };
        } else {
          toolCallsRef.current.push({
            toolCallId: typed.toolCallId,
            title: typed.title,
            status: typed.status,
            kind: typed.kind,
            timestamp: Date.now(),
          });
        }
        pendingRef.current = true;
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            flushToolCalls();
          }, FLUSH_INTERVAL_MS);
        }
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
    setToolCalls([]);
    toolCallsRef.current = [];
  }, []);

  return { toolCalls, clear };
}
