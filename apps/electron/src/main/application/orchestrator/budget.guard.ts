import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent } from '@main/core/types/event.types.js';

/**
 * Handles budget-exceeded auto-pause and manual resume of org roles.
 * Extracted from OrgOrchestrator (P2-2).
 */
export class BudgetGuard {
  constructor(
    private readonly logger: ILogger,
    private readonly roleRepo: IRoleRepository,
  ) {}

  async handleBudgetExceeded(event: DomainEvent): Promise<void> {
    const { orgId, totalTokens, limit } = event.payload as {
      orgId: string; totalTokens: number; limit: number;
    };

    this.logger.warn('Budget exceeded — pausing all org roles', { orgId, totalTokens, limit });

    const roles = await this.roleRepo.findByOrgId(orgId);
    let pausedCount = 0;
    for (const role of roles) {
      if (role.status === 'active') {
        await this.roleRepo.update({ id: role.id, status: 'paused' });
        pausedCount++;
      }
    }

    this.logger.info('Paused org roles due to budget', { orgId, pausedCount });
  }

  async resumeOrgRoles(
    orgId: string,
    onResumed?: (orgId: string) => Promise<void>,
  ): Promise<number> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    let resumedCount = 0;
    for (const role of roles) {
      if (role.status === 'paused') {
        await this.roleRepo.update({ id: role.id, status: 'active' });
        resumedCount++;
      }
    }

    this.logger.info('Resumed org roles', { orgId, resumedCount });

    if (resumedCount > 0 && onResumed) {
      await onResumed(orgId);
    }

    return resumedCount;
  }
}
