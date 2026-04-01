import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IRoleRepository, CreateRoleInput } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Organization } from '@main/core/types/domain.types.js';

export interface TemplateRoleDefinition {
  name: string;
  persona: string;
  skillCommands: string[];
  knowledgeBaseRefs: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  children: TemplateRoleDefinition[];
}

export interface OrgTemplate {
  id: string;
  name: string;
  description: string;
  rootRoles: TemplateRoleDefinition[];
}

const BMAD_TEMPLATE: OrgTemplate = {
  id: 'bmad-software-team',
  name: 'BMAD Software Team',
  description:
    'A hierarchical software development team with CTO, engineering manager, and specialized developer roles following the BMAD methodology.',
  rootRoles: [
    {
      name: 'CTO',
      persona:
        'You are the Chief Technology Officer. You oversee the entire technical organization, make high-level architectural decisions, and ensure the team delivers quality software aligned with business objectives. You review critical technical decisions and resolve escalations.',
      skillCommands: ['/bmad-create-architecture', '/bmad-code-review'],
      knowledgeBaseRefs: [],
      canApprove: true,
      canDelegate: true,
      requiresHumanApproval: true,
      children: [
        {
          name: 'Engineering Manager',
          persona:
            'You are the Engineering Manager. You coordinate the development team, break down epics into stories, assign tasks, and ensure smooth execution. You review code, manage sprint planning, and escalate blockers to the CTO.',
          skillCommands: ['/bmad-create-story', '/bmad-sprint-planning', '/bmad-code-review'],
          knowledgeBaseRefs: [],
          canApprove: true,
          canDelegate: true,
          requiresHumanApproval: false,
          children: [
            {
              name: 'Senior Developer',
              persona:
                'You are the Senior Developer. You implement complex features, write clean production code, review peer code, and mentor junior developers. You follow the project architecture and coding standards strictly.',
              skillCommands: ['/bmad-dev-story', '/bmad-code-review', '/security-audit'],
              knowledgeBaseRefs: [],
              canApprove: true,
              canDelegate: false,
              requiresHumanApproval: false,
              children: [],
            },
            {
              name: 'Developer',
              persona:
                'You are a Developer. You implement features and fix bugs following the project architecture, coding standards, and best practices. You write tests alongside your code and submit work for review.',
              skillCommands: ['/bmad-dev-story', '/test-generation'],
              knowledgeBaseRefs: [],
              canApprove: false,
              canDelegate: false,
              requiresHumanApproval: false,
              children: [],
            },
            {
              name: 'QA Engineer',
              persona:
                'You are the QA Engineer. You design and execute test strategies, write automated tests, identify edge cases, and ensure the product meets quality standards. You report issues and verify fixes.',
              skillCommands: ['/test-generation', '/bmad-code-review'],
              knowledgeBaseRefs: [],
              canApprove: true,
              canDelegate: false,
              requiresHumanApproval: false,
              children: [],
            },
          ],
        },
        {
          name: 'Analyst',
          persona:
            'You are the Business Analyst. You analyze requirements, decompose tasks, identify ambiguities, and ensure that the technical implementation aligns with business goals. You participate in design reviews and validate deliverables.',
          skillCommands: ['/bmad-analyst', '/task-decomposition'],
          knowledgeBaseRefs: [],
          canApprove: true,
          canDelegate: false,
          requiresHumanApproval: false,
          children: [],
        },
      ],
    },
  ],
};

const BUILTIN_TEMPLATES: OrgTemplate[] = [BMAD_TEMPLATE];

export class OrgTemplateService {
  constructor(
    private readonly orgRepo: IOrganizationRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly skillRepo: ISkillRepository,
    private readonly logger: ILogger,
  ) {}

  getTemplates(): OrgTemplate[] {
    return BUILTIN_TEMPLATES;
  }

  getTemplateById(id: string): OrgTemplate | null {
    return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
  }

  async loadTemplate(
    templateId: string,
    orgName: string,
    orgDescription: string,
    budgetLimit: number,
    workspacePath: string,
  ): Promise<Organization> {
    const template = this.getTemplateById(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Create the organization
    const org = await this.orgRepo.create({
      name: orgName,
      description: orgDescription,
      budgetLimit,
      orgTemplateId: template.id,
      workspacePath,
    });

    // Resolve skill command → id mapping
    const allSkills = await this.skillRepo.findAll();
    const commandToId = new Map(allSkills.map((s) => [s.command, s.id]));

    // Recursively create roles
    for (const rootDef of template.rootRoles) {
      await this.createRoleFromDef(org.id, null, rootDef, commandToId);
    }

    this.logger.info('Template loaded', { templateId, orgId: org.id, orgName });
    return org;
  }

  private async createRoleFromDef(
    orgId: string,
    parentId: string | null,
    def: TemplateRoleDefinition,
    commandToId: Map<string, string>,
  ): Promise<void> {
    const skillIds = def.skillCommands
      .map((cmd) => commandToId.get(cmd))
      .filter((id): id is string => id != null);

    const role = await this.roleRepo.create({
      orgId,
      name: def.name,
      parentId,
      persona: def.persona,
      knowledgeBaseRefs: def.knowledgeBaseRefs,
      skillIds,
      canApprove: def.canApprove,
      canDelegate: def.canDelegate,
      requiresHumanApproval: def.requiresHumanApproval,
    });

    for (const childDef of def.children) {
      await this.createRoleFromDef(orgId, role.id, childDef, commandToId);
    }
  }
}
