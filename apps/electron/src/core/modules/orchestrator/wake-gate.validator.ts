import { injectable } from 'tsyringe';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { CapibaraConfig } from '@core/config/config.types';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

export interface WakeGateResult {
  allowed: boolean;
  reason?: string;
}

@injectable()
export class WakeGateValidator {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly runRepo: IRunRepository,
    private readonly costTracker: CostTracker,
    private readonly config: CapibaraConfig,
    private readonly logger: ILogger,
  ) {}

  validate(roleId: string, orgId: string): WakeGateResult {
    const role = this.roleRepo.findById(roleId);
    if (!role) return { allowed: false, reason: 'Role not found' };
    if (role.status === 'paused') return { allowed: false, reason: 'Role is paused' };

    const activeRun = this.runRepo.findActiveByOrgId(orgId);
    if (activeRun) return { allowed: false, reason: `Active run exists: ${activeRun.id}` };

    if (this.config.execution.budgetLimit > 0) {
      const { totalCost } = this.costTracker.getBudgetUsage(orgId);
      if (totalCost >= this.config.execution.budgetLimit) {
        return { allowed: false, reason: 'Budget exceeded' };
      }
    }

    if (role.consecutiveWakeCount >= this.config.execution.maxConsecutiveWakes) {
      return { allowed: false, reason: `Circuit breaker: ${role.consecutiveWakeCount} consecutive wakes` };
    }

    return { allowed: true };
  }
}
