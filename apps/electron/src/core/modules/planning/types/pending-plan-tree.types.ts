import type { PlanTreeNode, PlanTreeMode } from '@core/foundation/events';

export type PendingPlanTreeStatus = 'active' | 'approved' | 'refining' | 'discarded' | 'expired';

export interface PendingPlanTree {
  id: string;
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: PlanTreeMode;
  tree: PlanTreeNode;
  version: number;
  status: PendingPlanTreeStatus;
  pendingFeedback: string | null;
  conversationId: string | null;
  submittedAt: string;
  expiresAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPendingPlanTreeInput {
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: PlanTreeMode;
  tree: PlanTreeNode;
  submittedAt: string;
  expiresAt: string;
  conversationId?: string | null;
}
