import { useState, useEffect, useRef } from 'react';

/**
 * Returns a formatted elapsed time string (mm:ss) that updates every second.
 * Pass null to stop the timer.
 */
export function useElapsedTimer(startedAt: string | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }

    const startTime = new Date(startedAt).getTime();

    const tick = () => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setElapsed(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startedAt]);

  return elapsed;
}
