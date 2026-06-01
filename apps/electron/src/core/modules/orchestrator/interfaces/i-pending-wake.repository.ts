/**
 * A queued wake request. Invariant: `taskId` and `conversationId` are not
 * both null — the dispatcher needs exactly one target. Both may be set
 * simultaneously when an AI is woken to respond to an inquiry inside a
 * task context (same invariant as the `runs` table).
 */
export interface PendingWake {
  id: string;
  roleId: string;
  orgId: string;
  reason: string;
  taskId: string | null;
  conversationId: string | null;
  priority: number;
  createdAt: string;
}

export interface CreatePendingWakeInput {
  roleId: string;
  orgId: string;
  reason: string;
  taskId: string | null;
  conversationId: string | null;
  priority: number;
}

export interface IPendingWakeRepository {
  findById(id: string): PendingWake | null;
  findByOrgId(orgId: string): PendingWake[];
  findByRoleId(roleId: string): PendingWake[];
  findNext(orgId: string): PendingWake | null;
  create(input: CreatePendingWakeInput): PendingWake;
  delete(id: string): void;
  deleteByRoleId(roleId: string): void;
  /** Remove all pending wakes targeting a specific conversation. */
  deleteByConversationId(conversationId: string): void;
}
