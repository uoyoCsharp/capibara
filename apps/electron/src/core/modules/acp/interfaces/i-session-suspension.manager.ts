import type { SessionSuspension, SuspendParams, ResumeDecision } from '../collaboration/suspension.types';

export interface ISessionSuspensionManager {
  /**
   * Suspend a session, recording the inquiries it is waiting for.
   * Automatically detects parent suspension and computes chain depth.
   */
  suspend(params: SuspendParams): SessionSuspension;

  /**
   * Called when an inquiry conversation is resolved.
   * Returns a ResumeDecision if the suspension is ready to resume, null otherwise.
   */
  onInquiryResolved(conversationId: string, response: string): ResumeDecision | null;

  /**
   * Find the suspension that is awaiting a specific inquiry conversation.
   */
  findSuspensionByInquiry(conversationId: string): SessionSuspension | null;

  /**
   * Find the active suspension for a role in an org (where this role is suspended).
   */
  findActiveByRole(roleId: string, orgId: string): SessionSuspension | null;

  /**
   * Find the active suspension that is waiting for the given role to respond.
   */
  findSuspensionAwaitingRole(roleId: string, orgId: string): SessionSuspension | null;

  /**
   * Get the current chain depth for a role in an org.
   */
  getChainDepth(orgId: string, fromRoleId: string): number;
}
