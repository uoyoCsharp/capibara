import type * as schema from '@agentclientprotocol/sdk';
import type {
  AcpSessionStatus,
  CloseReason,
  LifecycleIntent,
  SuspendReason,
} from '../types/acp.types';

/**
 * Pure session-lifecycle policy.
 *
 * The suspend-vs-close decision used to be inlined across three branches of
 * `AcpExecutor.executePrompt()`, which always closed the agent-side session and
 * broke resume. This module isolates that decision as a single pure function so it
 * is testable in isolation and cannot drift between exit paths.
 *
 * It holds NO state and performs NO I/O. The executor calls `decideLifecycle()`
 * with what it observed, then dispatches to the session manager's transitions.
 */

export interface LifecycleContext {
  /** Caller intent from RunCoordinator: planning → keep_alive, task → close_on_complete. */
  intent: LifecycleIntent;
  /** The stop reason reported by the agent for the just-completed prompt. */
  stopReason: schema.StopReason;
  /** Whether the run produced unresolved AI↔AI inquiries that require suspension. */
  hasPendingInquiry: boolean;
}

export type LifecycleOutcome =
  | { action: 'suspend'; reason: SuspendReason }
  | { action: 'close'; reason: CloseReason };

/**
 * Decide whether a session should be suspended (kept alive on the agent side) or
 * closed (protocol close) after a prompt completes.
 *
 * Decision table (first match wins):
 * | pendingInquiry | stopReason  | intent            | outcome                     |
 * |----------------|-------------|-------------------|-----------------------------|
 * | true           | any         | any               | suspend(collaboration)      |
 * | false          | cancelled   | any               | close(cancelled)            |
 * | false          | != end_turn | any               | close(error)                |
 * | false          | end_turn    | keep_alive        | suspend(idle)               |
 * | false          | end_turn    | close_on_complete | close(completed)            |
 *
 * A pending inquiry always wins: the task is not finished, it is waiting on another
 * role, so the session must stay alive regardless of intent or stop reason.
 */
export function decideLifecycle(ctx: LifecycleContext): LifecycleOutcome {
  if (ctx.hasPendingInquiry) {
    return { action: 'suspend', reason: 'collaboration' };
  }

  if (ctx.stopReason === 'cancelled') {
    // A clean user cancellation is not a fault — record it distinctly from genuine errors.
    return { action: 'close', reason: 'cancelled' };
  }

  if (ctx.stopReason !== 'end_turn') {
    // Abnormal termination (max_tokens, max_turn_requests, refusal):
    // not a resumable success — release the session.
    return { action: 'close', reason: 'error' };
  }

  if (ctx.intent === 'keep_alive') {
    return { action: 'suspend', reason: 'idle' };
  }

  return { action: 'close', reason: 'completed' };
}

/**
 * Explicit session-state machine. Centralizes which transitions are legal so the
 * manager (and its tests) share one definition rather than scattering guards.
 *
 * active    → suspended | closed
 * suspended → active (resume/load/rebuild) | expired (idle TTL) | closed
 * expired   → active (rebuild on next use)
 * closed    → (terminal)
 */
const ALLOWED_TRANSITIONS: Record<AcpSessionStatus, readonly AcpSessionStatus[]> = {
  active: ['suspended', 'closed'],
  suspended: ['active', 'expired', 'closed'],
  expired: ['active'],
  closed: [],
};

export function canTransition(from: AcpSessionStatus, to: AcpSessionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AcpSessionStatus, to: AcpSessionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal ACP session transition: ${from} → ${to}`);
  }
}
