import type { Skill, SkillCategory, SkillSource } from '../types/domain.types.js';

export interface CreateSkillInput {
  name: string;
  command: string;
  description: string;
  category: SkillCategory;
  source: SkillSource;
  orgTemplateId: string | null;
  customPromptContent: string | null;
}

export interface ISkillRepository {
  findById(id: string): Promise<Skill | null>;
  findByCommand(command: string): Promise<Skill | null>;
  findByCategory(category: SkillCategory): Promise<Skill[]>;
  findByOrgTemplateId(orgTemplateId: string): Promise<Skill[]>;
  findAll(): Promise<Skill[]>;
  create(input: CreateSkillInput): Promise<Skill>;
  update(id: string, input: Partial<CreateSkillInput>): Promise<Skill>;
  delete(id: string): Promise<void>;
}
