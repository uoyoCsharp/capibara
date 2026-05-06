import type { PendingPlanTree, PendingPlanTreeStatus, UpsertPendingPlanTreeInput } from '../types/pending-plan-tree.types';

export interface IPendingPlanTreeRepository {
  findById(id: string): PendingPlanTree | null;
  findActiveByRootTaskId(rootTaskId: string): PendingPlanTree | null;
  findActiveBySourceConversationId(conversationId: string): PendingPlanTree | null;
  findByOrgId(orgId: string): PendingPlanTree[];
  findExpired(now: string): PendingPlanTree[];
  upsert(input: UpsertPendingPlanTreeInput): PendingPlanTree;
  updateStatus(id: string, status: PendingPlanTreeStatus, reviewedAt?: string): void;
  updateFeedback(id: string, feedback: string | null): void;
  updateConversationId(id: string, conversationId: string): void;
  delete(id: string): void;
}
