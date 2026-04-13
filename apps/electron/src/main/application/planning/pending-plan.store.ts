import type { PendingPlanRecord } from '@shared/contracts.js';

/**
 * In-memory store for pending task plans submitted by the Planning Agent
 * via the `capibara_plan_tasks` MCP tool. Plans are keyed by orgId.
 * Plans live until the user confirms (batch create) or discards.
 */
export class PendingPlanStore {
  private static readonly MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  private plans = new Map<string, PendingPlanRecord>();

  set(orgId: string, plan: PendingPlanRecord): void {
    this.plans.set(orgId, plan);
  }

  get(orgId: string): PendingPlanRecord | null {
    const plan = this.plans.get(orgId);
    if (!plan) return null;
    // Auto-expire stale plans
    if (Date.now() - new Date(plan.createdAt).getTime() > PendingPlanStore.MAX_AGE_MS) {
      this.plans.delete(orgId);
      return null;
    }
    return plan;
  }

  remove(orgId: string): void {
    this.plans.delete(orgId);
  }

  has(orgId: string): boolean {
    return this.get(orgId) !== null;
  }
}
