export interface PendingWake {
  id: string;
  roleId: string;
  orgId: string;
  reason: string;
  taskId: string | null;
  priority: number;
  createdAt: string;
}

export interface CreatePendingWakeInput {
  roleId: string;
  orgId: string;
  reason: string;
  taskId: string | null;
  priority: number;
}

export interface IPendingWakeRepository {
  findById(id: string): PendingWake | null;
  findByOrgId(orgId: string): PendingWake[];
  findByRoleId(roleId: string): PendingWake[];
  findNext(orgId: string): PendingWake | null;
  create(input: CreatePendingWakeInput): PendingWake;
  delete(id: string): void;
  deleteByRoleId(roleId: string): void;
}
