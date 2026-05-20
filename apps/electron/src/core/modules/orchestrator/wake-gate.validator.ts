import { injectable } from 'tsyringe';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { CapibaraConfig } from '@core/config/config.types';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

export interface WakeGateResult {
  allowed: boolean;
  reason?: string;
}

@injectable()
export class WakeGateValidator {
  private schedulerPaused = false;

  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly runRepo: IRunRepository,
    private readonly config: CapibaraConfig,
    private readonly logger: ILogger,
  ) {}

  validate(roleId: string, orgId: string): WakeGateResult {
    if (this.schedulerPaused) return { allowed: false, reason: 'Scheduler is paused' };

    const role = this.roleRepo.findById(roleId);
    if (!role) return { allowed: false, reason: 'Role not found' };
    if (role.status === 'paused') return { allowed: false, reason: 'Role is paused' };

    const activeRun = this.runRepo.findActiveByOrgId(orgId);
    if (activeRun) return { allowed: false, reason: `Active run exists: ${activeRun.id}` };

    if (role.consecutiveWakeCount >= this.config.execution.maxConsecutiveWakes) {
      return { allowed: false, reason: `Circuit breaker: ${role.consecutiveWakeCount} consecutive wakes` };
    }

    return { allowed: true };
  }

  setSchedulerPaused(paused: boolean): void {
    this.schedulerPaused = paused;
    this.logger.info('Scheduler pause state changed', { paused });
  }

  isSchedulerPaused(): boolean {
    return this.schedulerPaused;
  }
}
