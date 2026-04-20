import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectable } from 'tsyringe';
import type { IOrganizationRepository } from '../interfaces/i-organization.repository';
import type { IRoleRepository } from '../interfaces/i-role.repository';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { Organization, OrgTemplate, TemplateRoleDefinition } from '../types/organization.types';
import type { SkillService } from './skill.service';

export interface ProcessSchemaProvider {
  saveSchema(orgId: string, schema: unknown): void;
  getDefaultSchema(): unknown | null;
}

@injectable()
export class OrgTemplateService {
  private templates: OrgTemplate[] = [];
  private processSchemaProvider: ProcessSchemaProvider | null = null;

  constructor(
    private readonly orgRepo: IOrganizationRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly skillService: SkillService,
    private readonly logger: ILogger,
    private readonly templatesDir: string,
  ) {}

  setProcessSchemaProvider(provider: ProcessSchemaProvider): void {
    this.processSchemaProvider = provider;
  }

  loadTemplatesFromDisk(): OrgTemplate[] {
    if (!existsSync(this.templatesDir)) {
      this.logger.warn('Templates directory not found', { path: this.templatesDir });
      return [];
    }

    this.templates = [];
    const files = readdirSync(this.templatesDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.templatesDir, file), 'utf-8');
        const template = JSON.parse(raw) as OrgTemplate;
        this.templates.push(template);
      } catch (err) {
        this.logger.error('Failed to load template', { file, error: String(err) });
      }
    }
    return this.templates;
  }

  getTemplates(): OrgTemplate[] {
    return this.templates;
  }

  loadTemplate(
    templateId: string,
    orgName: string,
    workspacePath: string,
  ): Organization {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const org = this.orgRepo.create({
      name: orgName,
      description: template.description,
      customInstructions: '',
      budgetLimit: 50.0,
      orgTemplateId: template.id,
      workspacePath,
    });

    if (this.processSchemaProvider) {
      const defaultSchema = this.processSchemaProvider.getDefaultSchema();
      if (defaultSchema) {
        this.processSchemaProvider.saveSchema(org.id, defaultSchema);
      }
    }

    const roleNameToId = new Map<string, string>();

    for (const rootRole of template.rootRoles) {
      this.createRoleRecursive(org.id, null, rootRole, roleNameToId);
    }

    const planningRole = this.roleRepo.create({
      orgId: org.id,
      name: 'Planning Assistant',
      parentId: null,
      persona: 'You are a planning assistant that helps break down work into structured task plans.',
      knowledgeBaseRefs: [],
      skillIds: [],
      canApprove: false,
      canDelegate: false,
      requiresHumanApproval: false,
      isSystemRole: true,
    });

    this.orgRepo.update({ id: org.id, planningRoleId: planningRole.id });

    if (template.planningRole?.roleRef) {
      const refId = roleNameToId.get(template.planningRole.roleRef);
      if (refId) {
        this.orgRepo.update({ id: org.id, planningRoleId: refId });
      }
    }

    return this.orgRepo.findById(org.id)!;
  }

  private createRoleRecursive(
    orgId: string,
    parentId: string | null,
    def: TemplateRoleDefinition,
    nameToId: Map<string, string>,
  ): void {
    const skillIds = def.skillCommands
      .map((cmd) => this.skillService.resolveCommandToId(cmd))
      .filter((id): id is string => id !== null);

    const role = this.roleRepo.create({
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

    nameToId.set(def.name, role.id);

    for (const child of def.children) {
      this.createRoleRecursive(orgId, role.id, child, nameToId);
    }
  }
}
