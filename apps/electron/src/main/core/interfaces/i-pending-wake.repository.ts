import type { PendingWake, WakeTrigger } from '../types/domain.types.js';

export interface CreatePendingWakeInput {
  roleId: string;
  orgId: string;
  trigger: WakeTrigger;
  taskNodeId?: string | null;
}

export interface IPendingWakeRepository {
  findByRoleId(roleId: string): Promise<PendingWake[]>;
  findByOrgId(orgId: string): Promise<PendingWake[]>;
  create(input: CreatePendingWakeInput): Promise<PendingWake>;
  consume(id: string): Promise<void>;
  consumeAllForRole(roleId: string): Promise<number>;
  consumeByRoleAndTask(roleId: string, taskNodeId: string): Promise<number>;
}
