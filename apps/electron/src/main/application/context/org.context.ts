import { injectable, inject } from 'tsyringe';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Organization, Role, TaskNode } from '@main/core/types/domain.types.js';
import {
  ORGANIZATION_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  TASK_REPO_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';
import { NotFoundError } from '@main/core/errors/capibara.errors.js';

/**
 * Provides a unified view of the organization for orchestration decisions.
 * See Architecture §5.4 — Snapshot Strategy.
 */
@injectable()
export class OrgContext {
  constructor(
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  async getOrganization(orgId: string): Promise<Organization> {
    const org = await this.orgRepo.findById(orgId);
    if (!org) throw new NotFoundError('Organization', orgId);
    return org;
  }

  async getRoleTree(orgId: string): Promise<Role[]> {
    return this.roleRepo.findByOrgId(orgId);
  }

  async getParentRole(roleId: string): Promise<Role | null> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || !role.parentId) return null;
    return this.roleRepo.findById(role.parentId);
  }

  async getSubordinates(roleId: string): Promise<Role[]> {
    return this.roleRepo.findChildren(roleId);
  }

  async getPeers(roleId: string): Promise<Role[]> {
    const role = await this.roleRepo.findById(roleId);
    if (!role || !role.parentId) return [];
    const siblings = await this.roleRepo.findChildren(role.parentId);
    return siblings.filter((r) => r.id !== roleId);
  }

  async getTaskTree(orgId: string): Promise<TaskNode[]> {
    return this.taskRepo.findByOrgId(orgId);
  }
}
