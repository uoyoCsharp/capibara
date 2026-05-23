import type { ISuspensionRepository } from '../interfaces/i-suspension.repository';

export interface ChainDepthValidation {
  allowed: boolean;
  currentDepth: number;
  maxDepth: number;
}

export interface CycleDetection {
  hasCycle: boolean;
  cycleRoleId?: string;
}

/**
 * Validates chain depth limits and detects circular inquiry chains.
 * Prevents infinite recursion in AI↔AI collaboration.
 */
export class ChainDepthGuard {
  constructor(
    private readonly suspensionRepo: ISuspensionRepository,
    private readonly maxChainDepth: number,
  ) {}

  /**
   * Check whether the given role can initiate a new inquiry in this org
   * without exceeding the max chain depth.
   */
  validateDepth(orgId: string, fromRoleId: string): ChainDepthValidation {
    const currentDepth = this.computeChainDepth(orgId, fromRoleId);
    return {
      allowed: currentDepth < this.maxChainDepth,
      currentDepth,
      maxDepth: this.maxChainDepth,
    };
  }

  /**
   * Check whether any of the target roles would create a circular chain.
   * A cycle occurs when a target role is already waiting (directly or indirectly)
   * for a response from the requesting role.
   */
  detectCycle(orgId: string, fromRoleId: string, targetRoleIds: string[]): CycleDetection {
    const activeSuspensions = this.suspensionRepo.findActiveByOrg(orgId);

    for (const targetRoleId of targetRoleIds) {
      // Direct cycle: target role has a suspension whose awaiting includes fromRoleId
      for (const susp of activeSuspensions) {
        if (susp.roleId !== targetRoleId) continue;
        const awaitingList = this.suspensionRepo.findAwaitingBySuspensionId(susp.id);
        if (awaitingList.some(a => a.respondentRoleId === fromRoleId && a.status !== 'resolved')) {
          return { hasCycle: true, cycleRoleId: targetRoleId };
        }
      }

      // Indirect cycle: walk the parent chain from fromRoleId's suspension up
      // to check if targetRoleId appears as the suspended role at any level
      const fromSuspension = this.suspensionRepo.findSuspensionAwaitingRole(fromRoleId, orgId);
      if (fromSuspension) {
        let current = fromSuspension;
        const visited = new Set<string>();
        while (current) {
          if (visited.has(current.id)) break;
          visited.add(current.id);
          if (current.roleId === targetRoleId) {
            return { hasCycle: true, cycleRoleId: targetRoleId };
          }
          if (current.parentSuspensionId) {
            current = this.suspensionRepo.findById(current.parentSuspensionId)!;
          } else {
            break;
          }
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * Compute the current chain depth for a role in an org.
   * Looks at active suspensions that are waiting for this role and returns
   * the maximum depth + 1.
   */
  private computeChainDepth(orgId: string, fromRoleId: string): number {
    const activeSuspensions = this.suspensionRepo.findActiveByOrg(orgId);
    let maxDepth = 0;
    for (const s of activeSuspensions) {
      const awaitingList = this.suspensionRepo.findAwaitingBySuspensionId(s.id);
      if (awaitingList.some(a => a.respondentRoleId === fromRoleId && a.status !== 'resolved')) {
        maxDepth = Math.max(maxDepth, s.chainDepth + 1);
      }
    }
    return maxDepth;
  }
}
