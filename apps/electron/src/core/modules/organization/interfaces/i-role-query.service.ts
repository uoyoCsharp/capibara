import type { Role } from '../types/organization.types';

/**
 * Interface for the read (query) side of RoleService.
 * Cross-module callers depend on this interface; composition-root binds the concrete RoleService.
 * Mutation methods (create, update, delete) are only needed within the organization module + IPC handlers.
 */
export interface IRoleQueryService {
  findById(id: string): Role | null;
  findByOrgId(orgId: string): Role[];
  findChildren(parentId: string): Role[];
  getParent(roleId: string): Role | null;
  getAncestors(roleId: string): Role[];
}
