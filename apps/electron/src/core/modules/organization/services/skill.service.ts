import { injectable } from 'tsyringe';
import type { ISkillRepository } from '../interfaces/i-skill.repository';
import type { Skill, CreateSkillInput, SkillCategory } from '../types/organization.types';
import { ValidationError } from '@core/foundation/errors/capibara.errors';

@injectable()
export class SkillService {
  constructor(private readonly skillRepo: ISkillRepository) {}

  findById(id: string): Skill | null {
    return this.skillRepo.findById(id);
  }

  findAll(): Skill[] {
    return this.skillRepo.findAll();
  }

  findByCategory(category: SkillCategory): Skill[] {
    return this.skillRepo.findByCategory(category);
  }

  findByOrgTemplateId(orgTemplateId: string): Skill[] {
    return this.skillRepo.findByOrgTemplateId(orgTemplateId);
  }

  create(input: CreateSkillInput): Skill {
    const existing = this.skillRepo.findByCommand(input.command);
    if (existing) {
      throw new ValidationError(`Skill command already exists: ${input.command}`);
    }
    return this.skillRepo.create(input);
  }

  update(id: string, input: Partial<CreateSkillInput>): Skill {
    if (input.command) {
      const existing = this.skillRepo.findByCommand(input.command);
      if (existing && existing.id !== id) {
        throw new ValidationError(`Skill command already exists: ${input.command}`);
      }
    }
    return this.skillRepo.update(id, input);
  }

  delete(id: string): void {
    const skill = this.skillRepo.findById(id);
    if (skill && skill.source !== 'custom') {
      throw new ValidationError(`Cannot delete ${skill.source} skill: ${skill.name}`);
    }
    this.skillRepo.delete(id);
  }

  resolveCommandToId(command: string): string | null {
    const skill = this.skillRepo.findByCommand(command);
    return skill?.id ?? null;
  }
}
