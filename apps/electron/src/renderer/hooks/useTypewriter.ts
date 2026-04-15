import { useState, useEffect, useRef } from 'react';

/**
 * Gradually reveals text with a typewriter effect.
 * When `fullText` changes (new content appended), the hook animates
 * from the previously displayed position to the new end.
 *
 * @param fullText The complete target text to display
 * @param charsPerTick How many characters to reveal per tick (default 3)
 * @param intervalMs Milliseconds between ticks (default 12)
 * @returns The currently visible portion of fullText
 */
export function useTypewriter(
  fullText: string,
  charsPerTick = 3,
  intervalMs = 12,
): string {
  const [displayed, setDisplayed] = useState('');
  const posRef = useRef(0);

  useEffect(() => {
    if (!fullText) {
      posRef.current = 0;
      setDisplayed('');
      return;
    }

    // If full text is already fully displayed, nothing to animate
    if (posRef.current >= fullText.length) {
      setDisplayed(fullText);
      return;
    }

    const timer = setInterval(() => {
      posRef.current = Math.min(posRef.current + charsPerTick, fullText.length);
      setDisplayed(fullText.slice(0, posRef.current));

      if (posRef.current >= fullText.length) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [fullText, charsPerTick, intervalMs]);

  return displayed;
}
