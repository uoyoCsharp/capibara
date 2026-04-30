import { useEffect } from 'react';
import type { SectionId } from '@core/shared/types';

/**
 * Six keys mapped to the six primary sections. Cmd/Ctrl + 1..6 jumps the
 * user directly. Ignored while the focus is in a text input, textarea, or
 * contenteditable element — typing "Cmd+2" in a task title should not
 * navigate away.
 */
export const SECTION_SHORTCUT_MAP: Readonly<Record<string, SectionId>> = {
  '1': 'dashboard',
  '2': 'tasks',
  '3': 'inbox',
  '4': 'team',
  '5': 'settings',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

export function useSectionShortcuts(onNavigate: (section: SectionId) => void): void {
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const section = SECTION_SHORTCUT_MAP[event.key];
      if (!section) return;

      event.preventDefault();
      onNavigate(section);
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNavigate]);
}
