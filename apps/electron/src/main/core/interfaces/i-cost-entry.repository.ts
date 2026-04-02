import type { CostEntry } from '../types/domain.types.js';

export interface CreateCostEntryInput {
  runId: string;
  roleId: string;
  orgId: string;
  tokenCount: number;
  costUsd: number;
}

export interface ICostEntryRepository {
  findByRunId(runId: string): Promise<CostEntry[]>;
  findByOrgId(orgId: string): Promise<CostEntry[]>;
  getTotalCostByOrgId(orgId: string): Promise<number>;
  getTotalTokensByOrgId(orgId: string): Promise<number>;
  create(input: CreateCostEntryInput): Promise<CostEntry>;
}
