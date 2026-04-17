import { injectable } from 'tsyringe';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';
import type { CapibaraConfig } from '@core/config/config.types';

@injectable()
export class BudgetGuard {
  constructor(
    private readonly costTracker: CostTracker,
    private readonly config: CapibaraConfig,
  ) {}

  check(orgId: string): { withinBudget: boolean; totalCost: number; limit: number } {
    const { totalCost } = this.costTracker.getBudgetUsage(orgId);
    const limit = this.config.execution.budgetLimit;
    return {
      withinBudget: limit <= 0 || totalCost < limit,
      totalCost,
      limit,
    };
  }
}
