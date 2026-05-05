import { describe, it, expect } from 'vitest';
import { SECTION_SHORTCUT_MAP } from '@renderer/hooks/use-section-shortcuts';

describe('SECTION_SHORTCUT_MAP', () => {
  it('maps keys 1-5 to five distinct sections', () => {
    const keys = Object.keys(SECTION_SHORTCUT_MAP);
    expect(keys).toEqual(['1', '2', '3', '4', '5']);
    const sections = Object.values(SECTION_SHORTCUT_MAP);
    expect(new Set(sections).size).toBe(5);
  });

  it('dashboard is first, settings is last (stable UX ordering)', () => {
    expect(SECTION_SHORTCUT_MAP['1']).toBe('dashboard');
    expect(SECTION_SHORTCUT_MAP['5']).toBe('settings');
  });

  it('includes all primary sections listed in the sidebar', () => {
    const sections = new Set(Object.values(SECTION_SHORTCUT_MAP));
    for (const expected of ['dashboard', 'tasks', 'inbox', 'team', 'settings']) {
      expect(sections.has(expected as never)).toBe(true);
    }
  });
});
