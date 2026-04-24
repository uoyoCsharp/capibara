import { describe, it, expect } from 'vitest';
import { SECTION_SHORTCUT_MAP } from '@renderer/hooks/use-section-shortcuts';

describe('SECTION_SHORTCUT_MAP', () => {
  it('maps keys 1-6 to six distinct sections', () => {
    const keys = Object.keys(SECTION_SHORTCUT_MAP);
    expect(keys).toEqual(['1', '2', '3', '4', '5', '6']);
    const sections = Object.values(SECTION_SHORTCUT_MAP);
    expect(new Set(sections).size).toBe(6);
  });

  it('dashboard is first, settings is last (stable UX ordering)', () => {
    expect(SECTION_SHORTCUT_MAP['1']).toBe('dashboard');
    expect(SECTION_SHORTCUT_MAP['6']).toBe('settings');
  });

  it('includes all six primary sections listed in the sidebar', () => {
    const sections = new Set(Object.values(SECTION_SHORTCUT_MAP));
    for (const expected of ['dashboard', 'tasks', 'inbox', 'planning', 'team', 'settings']) {
      expect(sections.has(expected as never)).toBe(true);
    }
  });
});
