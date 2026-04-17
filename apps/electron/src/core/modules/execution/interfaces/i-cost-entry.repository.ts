import type { CostEntry, CreateCostEntryInput } from '../types/execution.types';

export interface ICostEntryRepository {
  findByRunId(runId: string): CostEntry[];
  findByOrgId(orgId: string): CostEntry[];
  getTotalTokensByOrgId(orgId: string): number;
  getTotalCostByOrgId(orgId: string): number;
  create(input: CreateCostEntryInput): CostEntry;
}
