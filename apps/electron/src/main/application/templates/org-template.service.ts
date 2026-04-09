import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IRoleRepository, CreateRoleInput } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Organization } from '@main/core/types/domain.types.js';
import { DEFAULT_WORKFLOW_SCHEMA } from '../workflow/default-workflow-schema.js';

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

export class OrgTemplateService {
  private templates: OrgTemplate[] = [];
  private workflowEngine: IWorkflowEngine | null = null;

  constructor(
    private readonly orgRepo: IOrganizationRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly skillRepo: ISkillRepository,
    private readonly logger: ILogger,
    private readonly templatesDir: string,
  ) {
    this.loadTemplatesFromDisk();
  }

  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  getTemplates(): OrgTemplate[] {
    return this.templates;
  }

  getTemplateById(id: string): OrgTemplate | null {
    return this.templates.find((t) => t.id === id) ?? null;
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
      customInstructions: '',
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

    // Initialize default workflow schema
    if (this.workflowEngine) {
      try {
        await this.workflowEngine.saveSchema(org.id, DEFAULT_WORKFLOW_SCHEMA);
      } catch (err) {
        this.logger.error('Failed to create default schema for template org', { orgId: org.id, error: String(err) });
      }
    }

    this.logger.info('Template loaded', { templateId, orgId: org.id, orgName });
    return org;
  }

  private loadTemplatesFromDisk(): void {
    if (!existsSync(this.templatesDir)) {
      this.logger.warn('Templates directory not found', { path: this.templatesDir });
      return;
    }

    const files = readdirSync(this.templatesDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      this.logger.warn('No template files found', { path: this.templatesDir });
      return;
    }

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.templatesDir, file), 'utf-8');
        const data = JSON.parse(raw) as OrgTemplate;
        if (!data.id || !data.name || !Array.isArray(data.rootRoles)) {
          this.logger.error('Invalid template file, missing required fields', { file });
          continue;
        }
        this.templates.push(data);
        this.logger.info('Template loaded from file', { file, id: data.id });
      } catch (err) {
        this.logger.error('Failed to parse template file', { file, error: String(err) });
      }
    }
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
