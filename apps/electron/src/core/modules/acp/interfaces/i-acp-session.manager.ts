import type {
  AcpSessionRecord,
  AgentCapabilities,
  CloseReason,
  CreateSessionParams,
  ModelStateSummary,
  PromptContent,
  PromptResult,
  SuspendReason,
} from '../types/acp.types';

export interface IAcpSessionManager {
  /**
   * Create a new session and spawn the Agent subprocess if not already running.
   * Maps to ACP: initialize → session/new. Persists a lifecycle record (status 'active').
   */
  createSession(params: CreateSessionParams): Promise<AcpSessionRecord>;

  /**
   * Send a prompt to the session, consume session/update stream, return result after turn completes.
   * Maps to ACP: session/prompt → consume session/update stream → session/prompt response.
   */
  prompt(sessionId: string, content: PromptContent[]): Promise<PromptResult>;

  /**
   * Suspend a session WITHOUT a protocol close (ADR-3). The agent-side session stays alive for
   * in-run resume; status becomes 'suspended' with the given reason.
   */
  suspend(sessionId: string, reason: SuspendReason): Promise<void>;

  /**
   * Resume a suspended/expired session, dispatching by its resume strategy (resume | load |
   * rebuild). Falls back to rebuild when in-process runtime context is no longer cached.
   */
  resume(sessionId: string): Promise<void>;

  /**
   * Terminate a session: sends protocol closeSession and persists the close reason.
   */
  close(sessionId: string, reason: CloseReason): Promise<void>;

  /**
   * Expire an idle/suspended session: protocol closeSession + status 'expired' (rebuild on next use).
   */
  expire(sessionId: string): Promise<void>;

  /**
   * Startup reconciliation (ADR-7): mark persisted non-terminal sessions 'expired' since the
   * agent subprocess died with the previous app process. Lazy rebuild on next use; no eager reconnect.
   */
  reconcileOnStartup(): Promise<void>;

  /**
   * Idle-TTL sweep (ADR-7): expire idle suspensions older than the configured TTL.
   * Collaboration suspensions are exempt (handled on the lifecycle axis).
   */
  sweepIdle(nowIso: string): Promise<void>;

  /**
   * Cancel an in-progress prompt turn. Maps to ACP: session/cancel.
   */
  cancelPrompt(sessionId: string): Promise<void>;

  /** Query Agent capabilities. */
  getAgentCapabilities(agentId: string): AgentCapabilities | null;

  /**
   * Renderer-facing model state for an agent: the agent-advertised model list (live or last-cached)
   * merged with the user's stored default-model preference.
   */
  getModelState(agentId: string): ModelStateSummary;

  /**
   * Persist the user's default-model preference. Applied to the next session created, never to a
   * live session (REQ-6). Throws if the model is not advertised by the agent (BR-3).
   */
  setSelectedModel(agentId: string, modelId: string): ModelStateSummary;

  /** Get an active session for a role/org pair. */
  getActiveSession(roleId: string, orgId: string): AcpSessionRecord | null;

  /** Find a session by its ACP protocol session ID. */
  findByAcpSessionId(acpSessionId: string): AcpSessionRecord | null;

  /** Clear live connections and terminate Agent processes. Persisted records are left for reconcile. */
  shutdown(): Promise<void>;
}
