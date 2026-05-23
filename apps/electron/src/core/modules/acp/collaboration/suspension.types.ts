/**
 * Types for the session suspension system (AI↔AI collaboration).
 * Phase 3a: basic suspend + resume for single-round and multi-round inquiry.
 */

// ── Status enums ─────────────────────────────────────────

export type SuspensionStatus = 'suspended' | 'resumed' | 'timed_out' | 'cancelled';
export type AwaitingStatus = 'pending' | 'in_progress' | 'resolved' | 'timed_out';
export type AggregationMode = 'all' | 'any';

// ── Domain models ────────────────────────────────────────

export interface SessionSuspension {
  id: string;
  sessionId: string;           // internal AcpSession.id
  acpSessionId: string;        // ACP protocol session ID (for resume)
  runId: string;               // the run that was suspended
  roleId: string;
  orgId: string;
  taskId: string | null;
  aggregationMode: AggregationMode;
  parentSuspensionId: string | null;  // upstream suspension in chain collaboration
  chainDepth: number;                 // 0 = top-level, increments for each nested layer
  status: SuspensionStatus;
  suspendedAt: string;
  resumedAt: string | null;
  createdAt: string;
}

export interface SuspensionAwaiting {
  id: string;
  suspensionId: string;
  conversationId: string;      // the inquiry conversation being waited for
  respondentRoleId: string;
  status: AwaitingStatus;
  response: string | null;     // the reply content
  resolvedAt: string | null;
  createdAt: string;
}

// ── Input types ──────────────────────────────────────────

export interface CreateSuspensionInput {
  sessionId: string;
  acpSessionId: string;
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string | null;
  aggregationMode: AggregationMode;
  parentSuspensionId?: string | null;
  chainDepth?: number;
}

export interface CreateAwaitingInput {
  suspensionId: string;
  conversationId: string;
  respondentRoleId: string;
}

// ── Suspend / Resume ─────────────────────────────────────

export interface SuspendParams {
  sessionId: string;           // internal AcpSession.id
  acpSessionId: string;        // ACP protocol session ID
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string | null;
  awaitingInquiries: PendingInquiry[];
  aggregationMode: AggregationMode;
  parentSuspensionId?: string; // set automatically by manager if in chain
}

export interface PendingInquiry {
  conversationId: string;
  respondentRoleId: string;
}

export interface ResumeDecision {
  suspensionId: string;
  sessionId: string;           // internal AcpSession.id
  acpSessionId: string;        // ACP protocol session ID
  runId: string;
  roleId: string;
  orgId: string;
  taskId: string | null;
  aggregatedReply: string;
}
