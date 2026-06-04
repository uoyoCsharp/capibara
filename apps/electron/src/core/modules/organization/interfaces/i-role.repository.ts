import type { Role, CreateRoleInput, UpdateRoleInput } from '../types/organization.types';

export interface IRoleRepository {
  findById(id: string): Role | null;
  findByIds(ids: string[]): Role[];
  findByOrgId(orgId: string): Role[];
  findChildren(parentId: string): Role[];
  create(input: CreateRoleInput): Role;
  update(input: UpdateRoleInput): Role;
  delete(id: string): void;

  /** Update avatar BLOB and MIME type for a role. Pass null values to remove avatar. */
  updateRoleAvatar(roleId: string, avatarBuffer: Buffer | null, mimeType: string | null): void;

  /** Retrieve avatar data and MIME type for a role. Returns null if no avatar exists. */
  getRoleAvatar(roleId: string): { avatar: Buffer; mimeType: string } | null;
}
