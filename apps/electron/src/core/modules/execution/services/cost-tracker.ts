import { injectable } from 'tsyringe';
import type { ICostEntryRepository } from '../interfaces/i-cost-entry.repository';

@injectable()
export class CostTracker {
  constructor(private readonly costEntryRepo: ICostEntryRepository) {}

  recordCost(runId: string, roleId: string, orgId: string, tokenCount: number, costUsd: number): void {
    if (tokenCount <= 0) return;
    this.costEntryRepo.create({ runId, roleId, orgId, tokenCount, costUsd });
  }

  getCostUsage(orgId: string): { totalTokens: number; totalCost: number } {
    return {
      totalTokens: this.costEntryRepo.getTotalTokensByOrgId(orgId),
      totalCost: this.costEntryRepo.getTotalCostByOrgId(orgId),
    };
  }
}
