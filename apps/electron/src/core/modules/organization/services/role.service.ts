import { injectable } from 'tsyringe';
import type { IRoleRepository } from '../interfaces/i-role.repository';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { Role, CreateRoleInput, UpdateRoleInput } from '../types/organization.types';

@injectable()
export class RoleService {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly eventBus: IEventBus,
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

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.eventBus.emit({
      type: type as import('@core/foundation/events').DomainEventType,
      timestamp: new Date().toISOString(),
      payload,
    });
  }
}
