import { useEffect } from 'react';
import { useAppStore } from '../store/app.store';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

export function useDevPanel(): void {
  const devModeEnabled = useAppStore((s) => s.devModeEnabled);
  const toggleDevPanel = useAppStore((s) => s.toggleDevPanel);

  useEffect(() => {
    if (!devModeEnabled) return;

    function handler(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.altKey) return;
      if (event.key !== 'D' && event.key !== 'd') return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      toggleDevPanel();
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [devModeEnabled, toggleDevPanel]);
}
