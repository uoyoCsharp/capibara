import type { PromptContext } from '@main/core/interfaces/i-prompt-builder.js';

/**
 * Determines which prompt template to render.
 * Resolved once at the start of build(), then shared by
 * buildTools() and buildInstructions() to guarantee consistency.
 */
export type PromptScenario =
  // ── Conversation ────────────────────────────────────────
  | 'conversation_resume'        // trigger=discussion_reply
  | 'escalation_reply'           // trigger=conversation_escalation

  // ── Review ──────────────────────────────────────────────
  | 'review_children'            // trigger=review_requested + children>0

  // ── Revision ────────────────────────────────────────────
  | 'revision'                   // trigger=review_revise

  // ── Escalation / Delegation ─────────────────────────────
  | 'delegation_received'        // trigger=review_delegate
  | 'escalation_failure'         // trigger=retry_failed
  | 'dispute_arbitration'        // trigger=dispute_detected

  // ── Normal execution ────────────────────────────────────
  | 'propose_decomposition'      // epic/story + needsApproval + !hasApproval
  | 'execute_decomposition'      // epic/story + approved (including review_approve)
  | 'execute_leaf';              // task/subtask/bug/chore/spike

export function resolveScenario(ctx: PromptContext): PromptScenario {
  const { trigger } = ctx;

  // ── Conversation triggers (highest priority) ────────────
  if (trigger === 'discussion_reply')        return 'conversation_resume';
  if (trigger === 'conversation_escalation') return 'escalation_reply';

  // ── Direct-mapped triggers ──────────────────────────────
  if (trigger === 'review_revise')    return 'revision';
  if (trigger === 'review_delegate')  return 'delegation_received';
  if (trigger === 'retry_failed')     return 'escalation_failure';
  if (trigger === 'dispute_detected') return 'dispute_arbitration';

  // ── Review trigger ──────────────────────────────────────
  if (trigger === 'review_requested' && ctx.childrenAwaitingReview.length > 0) {
    return 'review_children';
  }
  // review_requested + children=0 falls through to normal execution

  // ── Normal execution (task_assigned, review_approve, etc) ──
  const isDecomposer = ctx.task.type === 'epic' || ctx.task.type === 'story';
  if (isDecomposer) {
    const needsApproval = ctx.role.requiresHumanApproval === true;
    const hasApproval = ctx.task.status === 'approved'
      || (ctx.discussionSummary?.voteStats?.APPROVE ?? 0) > 0;
    return (needsApproval && !hasApproval)
      ? 'propose_decomposition'
      : 'execute_decomposition';
  }

  return 'execute_leaf';
}
