import type { ISkillRepository, CreateSkillInput } from '@main/core/interfaces/i-skill.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

const BUILTIN_SKILLS: CreateSkillInput[] = [
  {
    name: 'Task Decomposition',
    command: '/task-decomposition',
    description: 'Analyze a task and break it down into smaller, actionable subtasks with appropriate depth and type labels.',
    category: 'analysis',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
  },
  {
    name: 'Code Review',
    command: '/code-review',
    description: 'Review code changes for quality, security, performance, and adherence to coding standards.',
    category: 'review',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
  },
  {
    name: 'Security Audit',
    command: '/security-audit',
    description: 'Perform a security audit identifying vulnerabilities, injection risks, authentication issues, and OWASP Top 10 concerns.',
    category: 'review',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
  },
  {
    name: 'Test Generation',
    command: '/test-generation',
    description: 'Generate comprehensive test cases including unit tests, integration tests, and edge case coverage.',
    category: 'test',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
  },
  {
    name: 'API Design',
    command: '/api-design',
    description: 'Design RESTful or GraphQL APIs following best practices for naming, versioning, error handling, and documentation.',
    category: 'design',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
  },
];

const BMAD_TEMPLATE_SKILLS: CreateSkillInput[] = [
  {
    name: 'BMAD Architecture',
    command: '/bmad-create-architecture',
    description: 'Create architecture solution design following BMAD methodology.',
    category: 'design',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Dev Story',
    command: '/bmad-dev-story',
    description: 'Execute story implementation following BMAD methodology context-filled story spec.',
    category: 'implementation',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Code Review',
    command: '/bmad-code-review',
    description: 'Review code changes using BMAD adversarial review layers.',
    category: 'review',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Create Story',
    command: '/bmad-create-story',
    description: 'Create a dedicated story file with all implementation context following BMAD methodology.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Analyst',
    command: '/bmad-analyst',
    description: 'Strategic business analyst and requirements expert for BMAD methodology.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Sprint Planning',
    command: '/bmad-sprint-planning',
    description: 'Generate sprint status tracking from epics following BMAD methodology.',
    category: 'general',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Create Epics and Stories',
    command: '/bmad-create-epics-and-stories',
    description: 'Break requirements into epics and user stories following BMAD methodology.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Create PRD',
    command: '/bmad-create-prd',
    description: 'Create a Product Requirements Document from scratch following BMAD methodology.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Validate PRD',
    command: '/bmad-validate-prd',
    description: 'Validate a PRD against BMAD standards and best practices.',
    category: 'review',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Product Brief',
    command: '/bmad-product-brief',
    description: 'Create or update product briefs through guided or autonomous discovery.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Domain Research',
    command: '/bmad-domain-research',
    description: 'Conduct domain and industry research for subject matter expertise.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Market Research',
    command: '/bmad-market-research',
    description: 'Conduct market research on competition, customers, and trends.',
    category: 'analysis',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Create UX Design',
    command: '/bmad-create-ux-design',
    description: 'Plan UX patterns and design specifications following BMAD methodology.',
    category: 'design',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Sprint Status',
    command: '/bmad-sprint-status',
    description: 'Summarize sprint status and surface risks.',
    category: 'general',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD QA E2E Tests',
    command: '/bmad-qa-generate-e2e-tests',
    description: 'Generate end-to-end automated tests for existing features.',
    category: 'test',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Document Project',
    command: '/bmad-document-project',
    description: 'Analyze an existing project to produce documentation for human and LLM consumption.',
    category: 'general',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
  {
    name: 'BMAD Generate Project Context',
    command: '/bmad-generate-project-context',
    description: 'Scan existing codebase to generate a lean LLM-optimized project-context.md.',
    category: 'general',
    source: 'template',
    orgTemplateId: 'bmad-software-team',
    customPromptContent: null,
  },
];

export class SkillSeeder {
  constructor(
    private readonly skillRepo: ISkillRepository,
    private readonly logger: ILogger,
  ) {}

  async seedBuiltinSkills(): Promise<void> {
    for (const skillInput of BUILTIN_SKILLS) {
      const existing = await this.skillRepo.findByCommand(skillInput.command);
      if (!existing) {
        await this.skillRepo.create(skillInput);
        this.logger.info('Seeded builtin skill', { command: skillInput.command });
      }
    }
  }

  async seedTemplateSkills(orgTemplateId: string): Promise<void> {
    const templateSkills = BMAD_TEMPLATE_SKILLS.filter(
      (s) => s.orgTemplateId === orgTemplateId,
    );

    for (const skillInput of templateSkills) {
      const existing = await this.skillRepo.findByCommand(skillInput.command);
      if (!existing) {
        await this.skillRepo.create(skillInput);
        this.logger.info('Seeded template skill', { command: skillInput.command, template: orgTemplateId });
      }
    }
  }

  async seedAll(): Promise<void> {
    await this.seedBuiltinSkills();
    // Seed all template skills regardless of org template loaded
    const templateIds = [...new Set(BMAD_TEMPLATE_SKILLS.map((s) => s.orgTemplateId).filter(Boolean))];
    for (const templateId of templateIds) {
      await this.seedTemplateSkills(templateId!);
    }
    this.logger.info('Skill seeding complete');
  }
}
