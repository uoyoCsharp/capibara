import type { PlanTreeNode, PlanTreeMode } from '@core/foundation/events';

export type PendingPlanTreeStatus = 'active' | 'approved' | 'refining' | 'discarded' | 'expired';

export interface PendingPlanTree {
  id: string;
  /** Anchored to an existing task when preview/eager decomposition is initiated from a task run.
   *  Null when the tree was produced from a conversation-only planning session. */
  rootTaskId: string | null;
  /** Anchored to a planning conversation when the tree was produced from a conversation-only session.
   *  Null when the tree is task-anchored. Exactly one of rootTaskId / sourceConversationId is non-null. */
  sourceConversationId: string | null;
  orgId: string;
  roleId: string;
  mode: PlanTreeMode;
  tree: PlanTreeNode;
  version: number;
  status: PendingPlanTreeStatus;
  pendingFeedback: string | null;
  /** Reference to a separate plan_review conversation used for human↔AI review of a task-anchored tree.
   *  Distinct from sourceConversationId. */
  conversationId: string | null;
  submittedAt: string;
  expiresAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UpsertPendingPlanTreeInput =
  | {
      rootTaskId: string;
      sourceConversationId?: null;
      orgId: string;
      roleId: string;
      mode: PlanTreeMode;
      tree: PlanTreeNode;
      submittedAt: string;
      expiresAt: string;
      conversationId?: string | null;
    }
  | {
      rootTaskId?: null;
      sourceConversationId: string;
      orgId: string;
      roleId: string;
      mode: PlanTreeMode;
      tree: PlanTreeNode;
      submittedAt: string;
      expiresAt: string;
      conversationId?: string | null;
    };
