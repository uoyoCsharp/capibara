import type { AcpSessionRecord, AcpSessionStatus } from '../types/acp.types';

/**
 * Fields supplied when persisting a new session. `id` and `createdAt` are assigned by
 * the repository (matching the project's other SQLite repositories); the rest carry the
 * lifecycle facts known at creation time.
 */
export type CreateAcpSessionInput = Omit<AcpSessionRecord, 'id' | 'createdAt'>;

/**
 * Durable store for Capibara's view of ACP session lifecycle (ADR-1). Single source of
 * truth for status/binding/activity; the agent process owns session *history* content.
 */
export interface IAcpSessionRepository {
  create(input: CreateAcpSessionInput): AcpSessionRecord;
  findById(id: string): AcpSessionRecord | null;
  findByAcpSessionId(acpSessionId: string): AcpSessionRecord | null;
  /** Resolve the session bound to a planning conversation (most recent if several). */
  findByConversationId(conversationId: string): AcpSessionRecord | null;
  /** A reusable (active or suspended) session for a role/org pair, if any. */
  findResumable(roleId: string, orgId: string): AcpSessionRecord | null;
  /**
   * Idle suspensions whose lastActivityAt is at or before `beforeIso`. Restricted to
   * suspendReason='idle' — collaboration suspensions are TTL-exempt (ADR-5). Sweeper input.
   */
  findIdleExpired(beforeIso: string): AcpSessionRecord[];
  /**
   * Collaboration suspensions whose lastActivityAt is at or before `beforeIso`. These are
   * exempt from the idle TTL (liveness is bound to the awaiting records) but reclaimed once
   * past the absolute liveness cap (ADR-5/ADR-7). Sweeper input.
   */
  findCollaborationExpired(beforeIso: string): AcpSessionRecord[];
  /** Non-terminal sessions (active|suspended) for startup reconciliation (ADR-7). */
  findNonTerminal(): AcpSessionRecord[];
  /** Update status and optionally patch related lifecycle fields in one write. */
  updateStatus(id: string, status: AcpSessionStatus, patch?: Partial<AcpSessionRecord>): void;
  /** Bump lastActivityAt; resets the idle-TTL clock. */
  touchActivity(id: string, iso: string): void;
}
