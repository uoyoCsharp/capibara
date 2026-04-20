import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillService } from '@core/modules/organization/services/skill.service';
import type { ISkillRepository } from '@core/modules/organization/interfaces/i-skill.repository';
import type { Skill } from '@core/modules/organization/types/organization.types';
import { ValidationError } from '@core/foundation/errors/capibara.errors';
import { createSkillInput } from '../../helpers/fixtures';

function createMockSkill(overrides?: Partial<Skill>): Skill {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    command: '/test-skill',
    description: 'A test skill',
    category: 'general',
    source: 'custom',
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SkillService', () => {
  let service: SkillService;
  let repo: ISkillRepository;

  beforeEach(() => {
    repo = {
      findById: vi.fn().mockReturnValue(createMockSkill()),
      findByCommand: vi.fn().mockReturnValue(null),
      findByCategory: vi.fn().mockReturnValue([createMockSkill()]),
      findByOrgTemplateId: vi.fn().mockReturnValue([]),
      findAll: vi.fn().mockReturnValue([createMockSkill()]),
      create: vi.fn().mockReturnValue(createMockSkill()),
      update: vi.fn().mockReturnValue(createMockSkill({ name: 'Updated' })),
      delete: vi.fn(),
    };
    service = new SkillService(repo);
  });

  describe('findById', () => {
    it('returns skill when found', () => {
      expect(service.findById('skill-1')).not.toBeNull();
    });

    it('returns null when not found', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      expect(service.findById('nonexistent')).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns all skills', () => {
      expect(service.findAll()).toHaveLength(1);
    });
  });

  describe('findByCategory', () => {
    it('returns skills filtered by category', () => {
      const skills = service.findByCategory('general');
      expect(skills).toHaveLength(1);
      expect(repo.findByCategory).toHaveBeenCalledWith('general');
    });
  });

  describe('findByOrgTemplateId', () => {
    it('delegates to repository', () => {
      service.findByOrgTemplateId('template-1');
      expect(repo.findByOrgTemplateId).toHaveBeenCalledWith('template-1');
    });
  });

  describe('create', () => {
    it('creates skill when command is unique', () => {
      const input = createSkillInput();
      const skill = service.create(input);

      expect(skill).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(input);
    });

    it('throws ValidationError when command already exists', () => {
      (repo.findByCommand as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill());

      expect(() => service.create(createSkillInput()))
        .toThrow(ValidationError);
    });

    it('throws ValidationError with descriptive message', () => {
      (repo.findByCommand as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill());

      expect(() => service.create(createSkillInput({ command: '/duplicate' })))
        .toThrow(/Skill command already exists/);
    });
  });

  describe('update', () => {
    it('updates skill when command not changing', () => {
      const result = service.update('skill-1', { name: 'New Name' });
      expect(result.name).toBe('Updated');
      expect(repo.update).toHaveBeenCalledWith('skill-1', { name: 'New Name' });
    });

    it('updates skill when command changes to unique value', () => {
      service.update('skill-1', { command: '/new-command' });
      expect(repo.update).toHaveBeenCalled();
    });

    it('throws ValidationError when command changes to existing one on different skill', () => {
      (repo.findByCommand as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill({ id: 'skill-other' }));

      expect(() => service.update('skill-1', { command: '/existing' }))
        .toThrow(ValidationError);
    });

    it('allows update when command belongs to same skill', () => {
      (repo.findByCommand as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill({ id: 'skill-1' }));

      expect(() => service.update('skill-1', { command: '/test-skill' }))
        .not.toThrow();
    });
  });

  describe('delete', () => {
    it('deletes custom skill', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill({ source: 'custom' }));

      service.delete('skill-1');
      expect(repo.delete).toHaveBeenCalledWith('skill-1');
    });

    it('throws ValidationError when deleting builtin skill', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill({ source: 'builtin', name: 'Core Skill' }));

      expect(() => service.delete('skill-1'))
        .toThrow(ValidationError);
    });

    it('throws ValidationError when deleting template skill', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill({ source: 'template', name: 'Tmpl Skill' }));

      expect(() => service.delete('skill-1'))
        .toThrow(/Cannot delete template skill/);
    });

    it('allows deletion when skill not found (repo handles NotFound)', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      expect(() => service.delete('nonexistent')).not.toThrow();
      expect(repo.delete).toHaveBeenCalledWith('nonexistent');
    });
  });

  describe('resolveCommandToId', () => {
    it('returns skill id when command exists', () => {
      (repo.findByCommand as ReturnType<typeof vi.fn>).mockReturnValue(createMockSkill({ id: 'skill-42' }));

      expect(service.resolveCommandToId('/test-skill')).toBe('skill-42');
    });

    it('returns null when command not found', () => {
      (repo.findByCommand as ReturnType<typeof vi.fn>).mockReturnValue(null);

      expect(service.resolveCommandToId('/unknown')).toBeNull();
    });
  });
});
