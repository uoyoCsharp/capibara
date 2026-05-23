import type { AcpSession, AgentCapabilities, CreateSessionParams, PromptContent, PromptResult } from '../types/acp.types';

export interface IAcpSessionManager {
  /**
   * Create a new session and spawn the Agent subprocess if not already running.
   * Maps to ACP: initialize → session/new
   */
  createSession(params: CreateSessionParams): Promise<AcpSession>;

  /**
   * Send a prompt to the session, consume session/update stream, return result after turn completes.
   * Maps to ACP: session/prompt → consume session/update stream → session/prompt response
   */
  prompt(sessionId: string, content: PromptContent[]): Promise<PromptResult>;

  /**
   * Resume a previously closed session.
   * Maps to ACP: session/resume | session/load
   */
  resumeSession(sessionId: string): Promise<void>;

  /**
   * Close a session, preserving state for potential resume.
   * Maps to ACP: session/close
   */
  closeSession(sessionId: string): Promise<void>;

  /**
   * Cancel an in-progress prompt turn.
   * Maps to ACP: session/cancel
   */
  cancelPrompt(sessionId: string): Promise<void>;

  /**
   * Query Agent capabilities.
   */
  getAgentCapabilities(agentId: string): AgentCapabilities | null;

  /**
   * Get the active session for a role/org pair.
   */
  getActiveSession(roleId: string, orgId: string): AcpSession | null;

  /**
   * Find a session by its ACP protocol session ID.
   */
  findByAcpSessionId(acpSessionId: string): AcpSession | null;

  /**
   * Close all sessions and terminate Agent processes.
   */
  shutdown(): Promise<void>;
}
