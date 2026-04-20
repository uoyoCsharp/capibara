import type { Run, RunStatus, CreateRunInput } from '../types/execution.types';

export interface IRunRepository {
  findById(id: string): Run | null;
  findByOrgId(orgId: string): Run[];
  findByTaskId(taskId: string): Run[];
  findActiveByRoleId(roleId: string): Run | null;
  findActiveByOrgId(orgId: string): Run | null;
  create(input: CreateRunInput): Run;
  updateStatus(id: string, status: RunStatus): void;
  finish(id: string, status: RunStatus, tokenCount?: number, costUsd?: number, sessionId?: string | null, summary?: string | null, errorMessage?: string | null): void;
}
