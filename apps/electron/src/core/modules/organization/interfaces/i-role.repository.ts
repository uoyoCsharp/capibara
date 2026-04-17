import type { Role, CreateRoleInput, UpdateRoleInput } from '../types/organization.types';

export interface IRoleRepository {
  findById(id: string): Role | null;
  findByIds(ids: string[]): Role[];
  findByOrgId(orgId: string): Role[];
  findChildren(parentId: string): Role[];
  create(input: CreateRoleInput): Role;
  update(input: UpdateRoleInput): Role;
  delete(id: string): void;
}
