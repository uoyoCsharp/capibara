import type { Skill, CreateSkillInput, SkillCategory } from '../types/organization.types';

export interface ISkillRepository {
  findById(id: string): Skill | null;
  findByCommand(command: string): Skill | null;
  findByCategory(category: SkillCategory): Skill[];
  findByOrgTemplateId(orgTemplateId: string): Skill[];
  findAll(): Skill[];
  create(input: CreateSkillInput): Skill;
  update(id: string, input: Partial<CreateSkillInput>): Skill;
  delete(id: string): void;
}
