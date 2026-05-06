import { container } from 'tsyringe';
import {
  ORGANIZATION_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  SKILL_REPO_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import { SqliteOrganizationRepository } from '@core/modules/organization/persistence/sqlite-organization.repository';
import { SqliteRoleRepository } from '@core/modules/organization/persistence/sqlite-role.repository';
import { SqliteSkillRepository } from '@core/modules/organization/persistence/sqlite-skill.repository';
import { OrganizationService } from '@core/modules/organization/services/organization.service';
import { RoleService } from '@core/modules/organization/services/role.service';
import { SkillService } from '@core/modules/organization/services/skill.service';
import { OrgTemplateService } from '@core/modules/organization/services/org-template.service';
import { SkillSeeder } from '@core/modules/organization/services/skill-seeder';

export function registerOrganizationModule(
  connection: ISqliteConnection,
  eventPublisher: IEventPublisher,
  logger: ILogger,
  templatesDir: string,
): {
  organizationService: OrganizationService;
  roleService: RoleService;
  skillService: SkillService;
  orgTemplateService: OrgTemplateService;
  skillSeeder: SkillSeeder;
  orgRepo: SqliteOrganizationRepository;
  roleRepo: SqliteRoleRepository;
} {
  const orgRepo = new SqliteOrganizationRepository(connection);
  const roleRepo = new SqliteRoleRepository(connection);
  const skillRepo = new SqliteSkillRepository(connection);

  const organizationService = new OrganizationService(orgRepo, eventPublisher);
  const roleService = new RoleService(roleRepo, eventPublisher);
  const skillService = new SkillService(skillRepo);
  const orgTemplateService = new OrgTemplateService(orgRepo, roleRepo, skillService, logger, templatesDir);
  const skillSeeder = new SkillSeeder(skillRepo);

  container.register(ORGANIZATION_REPO_TOKEN, { useValue: orgRepo });
  container.register(ROLE_REPO_TOKEN, { useValue: roleRepo });
  container.register(SKILL_REPO_TOKEN, { useValue: skillRepo });

  return { organizationService, roleService, skillService, orgTemplateService, skillSeeder, orgRepo, roleRepo };
}
