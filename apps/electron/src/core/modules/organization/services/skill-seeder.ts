import { injectable } from 'tsyringe';
import type { ISkillRepository } from '../interfaces/i-skill.repository';
import type { CreateSkillInput } from '../types/organization.types';

const BMAD_TEMPLATE_SKILLS: CreateSkillInput[] = [
  { name: 'Analyst', command: '/bmad-analyst', description: 'Analyze requirements and project scope', category: 'analysis', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Domain Research', command: '/bmad-domain-research', description: 'Research domain concepts and terminology', category: 'analysis', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Market Research', command: '/bmad-market-research', description: 'Research market trends and competitors', category: 'analysis', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Create PRD', command: '/bmad-create-prd', description: 'Create product requirements document', category: 'analysis', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Validate PRD', command: '/bmad-validate-prd', description: 'Validate product requirements document', category: 'review', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Create Architecture', command: '/bmad-create-architecture', description: 'Design system architecture', category: 'design', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Create UX Design', command: '/bmad-create-ux-design', description: 'Create UX wireframes and design specs', category: 'design', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Create Epics', command: '/bmad-create-epics', description: 'Break down work into epics and stories', category: 'design', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Dev Story', command: '/bmad-dev-story', description: 'Implement a development story', category: 'implementation', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Code Review', command: '/bmad-code-review', description: 'Review code changes', category: 'review', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'QA E2E Tests', command: '/bmad-qa-generate-e2e-tests', description: 'Generate end-to-end test cases', category: 'test', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Sprint Planning', command: '/bmad-sprint-planning', description: 'Plan sprint work items', category: 'general', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Sprint Status', command: '/bmad-sprint-status', description: 'Report sprint progress', category: 'general', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
  { name: 'Document Project', command: '/bmad-document-project', description: 'Generate project documentation', category: 'general', source: 'template', orgTemplateId: 'bmad-software-team', customPromptContent: null },
];

@injectable()
export class SkillSeeder {
  constructor(private readonly skillRepo: ISkillRepository) {}

  seedTemplateSkills(): void {
    for (const skill of BMAD_TEMPLATE_SKILLS) {
      const existing = this.skillRepo.findByCommand(skill.command);
      if (!existing) {
        this.skillRepo.create(skill);
      }
    }
  }

  seedAll(): void {
    this.seedTemplateSkills();
  }
}
