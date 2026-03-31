import type { Run, RunStatus, WakeTrigger } from '../types/domain.types.js';

export interface CreateRunInput {
  orgId: string;
  taskNodeId: string;
  roleId: string;
  trigger: WakeTrigger;
}

export interface IRunRepository {
  findById(id: string): Promise<Run | null>;
  findByOrgId(orgId: string): Promise<Run[]>;
  findByTaskId(taskNodeId: string): Promise<Run[]>;
  findActiveByRoleId(roleId: string): Promise<Run | null>;
  create(input: CreateRunInput): Promise<Run>;
  updateStatus(id: string, status: RunStatus): Promise<void>;
  appendOutputLog(id: string, chunk: string): Promise<void>;
  setCost(id: string, costUsd: number): Promise<void>;
  finish(id: string, status: RunStatus, costUsd: number): Promise<void>;
}
