import type { PlanTreeNode, PlanTreeMode } from '@core/foundation/events';
import type { PendingPlanTree } from '../types/pending-plan-tree.types';

/**
 * Interface for PlanningService — owns plan tree submission, approval, discard, and refinement.
 * Cross-module callers depend on this interface; composition-root binds the concrete.
 */
export interface IPlanningService {
  submit(input: {
    rootTaskId: string | null;
    sourceConversationId: string | null;
    orgId: string;
    roleId: string;
    rootType: string | null;
    mode: PlanTreeMode;
    tree: PlanTreeNode;
  }): { mode: PlanTreeMode; nodeCount: number; maxDepth: number };

  getPendingTree(rootTaskId: string): PendingPlanTree | undefined;
  getPendingTreeByConversation(conversationId: string): PendingPlanTree | undefined;

  approvePlanTree(rootTaskId: string, expectedVersion?: number): { ok: boolean; code?: string; message?: string };
  approvePlanTreeByConversation(conversationId: string, expectedVersion?: number): { ok: boolean; code?: string; message?: string };

  discardPlanTree(rootTaskId: string, reason: string | null): { ok: boolean; code?: string; message?: string };
  discardPlanTreeByConversation(conversationId: string, reason: string | null): { ok: boolean; code?: string; message?: string };

  refinePlanTree(rootTaskId: string, feedback: string): { ok: boolean; code?: string; message?: string };
  refinePlanTreeByConversation(conversationId: string, feedback: string): { ok: boolean; code?: string; message?: string };

  consumePendingFeedback(rootTaskId: string): string | null;
  consumePendingFeedbackByConversation(conversationId: string): string | null;

  expireStale(): void;
}
