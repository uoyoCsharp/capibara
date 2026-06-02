import { injectable } from 'tsyringe';
import type { IRoleQueryService } from '../interfaces/i-role-query.service';
import type { IRoleRepository } from '../interfaces/i-role.repository';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
import type { Role, CreateRoleInput, UpdateRoleInput } from '../types/organization.types';

@injectable()
export class RoleService implements IRoleQueryService {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  findById(id: string): Role | null {
    return this.roleRepo.findById(id);
  }

  findByOrgId(orgId: string): Role[] {
    return this.roleRepo.findByOrgId(orgId);
  }

  findChildren(parentId: string): Role[] {
    return this.roleRepo.findChildren(parentId);
  }

  getParent(roleId: string): Role | null {
    const role = this.roleRepo.findById(roleId);
    if (!role?.parentId) return null;
    return this.roleRepo.findById(role.parentId);
  }

  getAncestors(roleId: string): Role[] {
    const ancestors: Role[] = [];
    let current = this.roleRepo.findById(roleId);
    while (current?.parentId) {
      const parent = this.roleRepo.findById(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  create(input: CreateRoleInput): Role {
    const role = this.roleRepo.create(input);
    this.emitEvent('role:created', { roleId: role.id, orgId: role.orgId, name: role.name });
    return role;
  }

  update(input: UpdateRoleInput): Role {
    const role = this.roleRepo.update(input);
    this.emitEvent('role:updated', { roleId: role.id, orgId: role.orgId });
    return role;
  }

  delete(id: string): void {
    const role = this.roleRepo.findById(id);
    this.roleRepo.delete(id);
    if (role) {
      this.emitEvent('role:deleted', { roleId: id, orgId: role.orgId });
    }
  }

  private emitEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventPublisher.publish(type, payload);
  }
}
