import { describe, it, expect } from 'vitest';
import { filterSkills } from '@renderer/components/skills/SkillsPage';
import type { SkillRecord } from '@core/shared/types';

function skill(overrides: Partial<SkillRecord> & { id: string; name: string }): SkillRecord {
  return {
    command: `/cmd-${overrides.id}`,
    description: '',
    category: 'general',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: '',
    ...overrides,
  };
}

describe('filterSkills', () => {
  const skills: SkillRecord[] = [
    skill({ id: '1', name: 'Quick Review', command: '/review', category: 'review' }),
    skill({ id: '2', name: 'Design Doc', command: '/design-doc', category: 'design' }),
    skill({ id: '3', name: 'Test Plan', command: '/test-plan', category: 'test' }),
  ];

  it('returns all skills when no filters applied', () => {
    expect(filterSkills(skills, '', '')).toHaveLength(3);
  });

  it('filters by category', () => {
    const result = filterSkills(skills, '', 'review');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Quick Review');
  });

  it('filters by search against name', () => {
    const result = filterSkills(skills, 'quick', '');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Quick Review');
  });

  it('filters by search against command', () => {
    const result = filterSkills(skills, 'design-doc', '');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('search is case-insensitive', () => {
    expect(filterSkills(skills, 'REVIEW', '')).toHaveLength(1);
  });

  it('combines search and category (AND)', () => {
    expect(filterSkills(skills, 'design', 'review')).toHaveLength(0);
    expect(filterSkills(skills, 'design', 'design')).toHaveLength(1);
  });

  it('trims whitespace-only search', () => {
    expect(filterSkills(skills, '   ', '')).toHaveLength(3);
  });
});
