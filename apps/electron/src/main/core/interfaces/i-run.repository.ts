import type { Run, RunStatus, WakeTrigger } from '../types/domain.types.js';

export interface CreateRunInput {
  orgId: string;
  taskNodeId: string | null;
  roleId: string;
  trigger: WakeTrigger;
}

export interface IRunRepository {
  findById(id: string): Promise<Run | null>;
  findByOrgId(orgId: string): Promise<Run[]>;
  findByTaskId(taskNodeId: string): Promise<Run[]>;
  findActiveByRoleId(roleId: string): Promise<Run | null>;
  findActiveByOrgId(orgId: string): Promise<Run | null>;
  findAnyActiveRun(): Promise<Run | null>;
  create(input: CreateRunInput): Promise<Run>;
  updateStatus(id: string, status: RunStatus): Promise<void>;
  finish(id: string, status: RunStatus, tokenCount?: number, sessionId?: string | null): Promise<void>;
  findLastSessionId(roleId: string, taskNodeId: string): Promise<string | null>;
}
