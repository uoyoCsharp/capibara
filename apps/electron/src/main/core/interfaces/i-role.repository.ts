import type { Role, RoleStatus } from '../types/domain.types.js';

export interface CreateRoleInput {
  orgId: string;
  name: string;
  parentId: string | null;
  persona: string;
  knowledgeBaseRefs: string[];
  skillIds: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
}

export interface UpdateRoleInput {
  id: string;
  name?: string;
  persona?: string;
  knowledgeBaseRefs?: string[];
  skillIds?: string[];
  canApprove?: boolean;
  canDelegate?: boolean;
  requiresHumanApproval?: boolean;
  consecutiveWakeCount?: number;
  status?: RoleStatus;
}

export interface IRoleRepository {
  findById(id: string): Promise<Role | null>;
  findByIds(ids: string[]): Promise<Role[]>;
  findByOrgId(orgId: string): Promise<Role[]>;
  findChildren(parentId: string): Promise<Role[]>;
  create(input: CreateRoleInput): Promise<Role>;
  update(input: UpdateRoleInput): Promise<Role>;
  delete(id: string): Promise<void>;
}
