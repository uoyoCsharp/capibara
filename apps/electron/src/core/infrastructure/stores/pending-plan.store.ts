import { injectable } from 'tsyringe';

export interface PendingPlan {
  conversationId: string;
  orgId: string;
  roleId: string;
  tasks: unknown[];
  submittedAt: string;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

@injectable()
export class PendingPlanStore {
  private readonly plans = new Map<string, PendingPlan>();

  get(conversationId: string): PendingPlan | undefined {
    const plan = this.plans.get(conversationId);
    if (!plan) return undefined;
    if (Date.now() - new Date(plan.submittedAt).getTime() > MAX_AGE_MS) {
      this.plans.delete(conversationId);
      return undefined;
    }
    return plan;
  }

  set(conversationId: string, plan: PendingPlan): void {
    this.plans.set(conversationId, plan);
  }

  has(conversationId: string): boolean {
    return this.get(conversationId) !== undefined;
  }

  delete(conversationId: string): boolean {
    return this.plans.delete(conversationId);
  }

  clear(): void {
    this.plans.clear();
  }
}
