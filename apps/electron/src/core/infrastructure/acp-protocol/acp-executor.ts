import type { IExecutor, ExecutorHandle, HandleLogCallback } from '@core/modules/execution/interfaces/i-executor';
import type { ExecutorInput, ExecutorOutput } from '@core/modules/execution/types/execution.types';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import { randomUUID } from 'node:crypto';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import type { AcpFilesystemHandler } from '@core/modules/acp/handlers/acp-filesystem.handler';
import type { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import type { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';
import type { AgentRegistryConfig, PromptContent, PromptResult } from '@core/modules/acp/types/acp.types';
import type { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import type { PendingInquiry } from '@core/modules/acp/collaboration/suspension.types';
import { decideLifecycle } from './session-lifecycle';

/**
 * IExecutor implementation that bridges RunEngine to ACP Session Manager.
 * Keeps the IExecutor interface unchanged, minimizing RunEngine changes.
 */
export class AcpExecutor implements IExecutor {
  private roleRepo: IRoleRepository | null = null;
  private convRepo: IConversationRepository | null = null;
  private suspensionManager: ISessionSuspensionManager | null = null;
  private filesystemHandler: AcpFilesystemHandler | null = null;
  private permissionHandler: AcpPermissionHandler | null = null;
  private auditRepository: AcpAuditRepository | null = null;

  constructor(
    private readonly sessionManager: IAcpSessionManager,
    private readonly updateHandler: AcpUpdateHandler,
    private readonly mcpConfigBuilder: AcpMcpConfigBuilder,
    private readonly agentConfig: AgentRegistryConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * Set role repository for resolving file access paths.
   */
  setRoleRepository(repo: IRoleRepository): void {
    this.roleRepo = repo;
  }

  /**
   * Set conversation repository for detecting pending inquiries after prompt.
   */
  setConversationRepository(repo: IConversationRepository): void {
    this.convRepo = repo;
  }

  /**
   * Set suspension manager for AI↔AI collaboration.
   */
  setSuspensionManager(mgr: ISessionSuspensionManager): void {
    this.suspensionManager = mgr;
  }

  /**
   * Set audit components for draining and persisting access/tool-call logs.
   */
  setAuditComponents(
    filesystemHandler: AcpFilesystemHandler,
    permissionHandler: AcpPermissionHandler,
    auditRepository: AcpAuditRepository,
  ): void {
    this.filesystemHandler = filesystemHandler;
    this.permissionHandler = permissionHandler;
    this.auditRepository = auditRepository;
  }

  async spawn(input: ExecutorInput): Promise<ExecutorHandle> {
    // Resume path: if sessionId is provided, resume an existing ACP session.
    if (input.sessionId) {
      try {
        return await this.spawnResume(input);
      } catch (err) {
        // Resume falling back to a fresh session is an expected outcome (the agent-side
        // session may be gone after restart/expiry), not an error — log at INFO (REQ-X2).
        this.logger.info('ACP resume unavailable; starting a fresh session', {
          runId: input.runId,
          roleId: input.roleId,
          orgId: input.orgId,
          requestedSessionId: input.sessionId,
          reason: String(err),
        });
      }
    }

    // 1. Resolve Agent config
    let agentId = this.agentConfig.defaultAgent;
    const registered = this.agentConfig.registry.some((entry) => entry.id === agentId);
    if (!registered) {
      const fallback = this.agentConfig.registry[0]?.id;
      if (!fallback) {
        throw new Error('No ACP agents are registered');
      }
      this.logger.warn('Default ACP agent is not registered; using fallback agent', {
        configuredAgent: agentId,
        fallbackAgent: fallback,
        runId: input.runId,
        roleId: input.roleId,
      });
      agentId = fallback;
    }

    // 2. Build MCP server config (use agent's preferred transport)
    const agentEntry = this.agentConfig.registry.find((e) => e.id === agentId);
    const sessionKey = randomUUID();
    const mcpServers = this.mcpConfigBuilder.buildMcpServers(sessionKey, agentEntry?.mcpTransport);

    // 3. Resolve allowed paths from role's file access policy
    let allowedPaths: string[] | undefined;
    if (this.roleRepo) {
      const role = this.roleRepo.findById(input.roleId);
      if (role?.fileAccessPaths) {
        allowedPaths = role.fileAccessPaths;
      }
    }

    // 4. Create ACP session
    const session = await this.sessionManager.createSession({
      agentId,
      roleId: input.roleId,
      orgId: input.orgId,
      runId: input.runId,
      taskId: input.taskId,
      cwd: input.projectDir,
      mcpServers,
      allowedPaths,
      sessionKey,
    });

    // 5. Build prompt content
    const content: PromptContent[] = [
      { type: 'text', text: input.prompt },
    ];

    // 6. Associate session with run for event emission
    this.updateHandler.setRunId(session.acpSessionId, input.runId);

    // 7. Execute prompt
    const completePromise = this.executePrompt(session.id, session.acpSessionId, content, input);

    return {
      runId: input.runId,
      complete: () => completePromise,
      cancel: () => {
        this.sessionManager.cancelPrompt(session.id).catch(err => {
          this.logger.error('Failed to cancel prompt', { sessionId: session.id, error: String(err) });
        });
      },
      onLog: (cb: HandleLogCallback) => {
        this.updateHandler.onLog(session.acpSessionId, cb);
      },
    };
  }

  /**
   * Resume a previously suspended ACP session with an aggregated reply.
   */
  private async spawnResume(input: ExecutorInput): Promise<ExecutorHandle> {
    const session = this.sessionManager.findByAcpSessionId(input.sessionId!);
    if (!session) {
      throw new Error(`ACP session not found for resume: ${input.sessionId}`);
    }

    // A closed session is permanently terminated — there is nothing to resume; fall back to fresh.
    if (session.status === 'closed') {
      throw new Error(`ACP session ${session.id} is closed; cannot resume`);
    }

    // Resume the ACP session (the manager dispatches resume | load | rebuild by strategy;
    // an 'expired' record rebuilds a fresh agent-side session transparently).
    await this.sessionManager.resume(session.id);

    // Associate session with run for event emission
    this.updateHandler.setRunId(session.acpSessionId, input.runId);

    // Build prompt content (aggregated reply is in input.prompt)
    const content: PromptContent[] = [
      { type: 'text', text: input.prompt },
    ];

    const completePromise = this.executePrompt(session.id, session.acpSessionId, content, input);

    return {
      runId: input.runId,
      complete: () => completePromise,
      cancel: () => {
        this.sessionManager.cancelPrompt(session.id).catch(err => {
          this.logger.error('Failed to cancel prompt', { sessionId: session.id, error: String(err) });
        });
      },
      onLog: (cb: HandleLogCallback) => {
        this.updateHandler.onLog(session.acpSessionId, cb);
      },
    };
  }

  private async executePrompt(
    sessionId: string,
    acpSessionId: string,
    content: PromptContent[],
    input: ExecutorInput,
  ): Promise<ExecutorOutput> {
    // Aggregate agent text chunks so we can populate summary for conversation persistence.
    // AcpUpdateHandler.onText only receives agent_message_chunk text (no tool-call JSON).
    let aggregatedText = '';
    this.updateHandler.onText(acpSessionId, (text) => {
      aggregatedText += text;
    });

    try {
      const result = await this.sessionManager.prompt(sessionId, content);

      // Drain and persist audit logs
      await this.flushAuditLogs(acpSessionId, input);

      // Decide the session's fate from caller intent + observed outcome (ADR-2/3). The executor
      // holds no lifecycle policy itself — it asks decideLifecycle, then dispatches the transition.
      const pendingInquiries = this.detectPendingInquiries(input);
      const outcome = decideLifecycle({
        intent: input.lifecycleIntent ?? 'close_on_complete',
        stopReason: result.stopReason,
        hasPendingInquiry: pendingInquiries.length > 0,
      });

      // Suspend path (pending inquiry): keep the agent-side session alive (ADR-3) and record
      // the collaboration suspension so the run resumes once the awaited replies arrive.
      if (outcome.action === 'suspend' && outcome.reason === 'collaboration') {
        // A collaboration suspend without a suspension manager would orphan the session: it would
        // be marked suspended (TTL-exempt) with no awaiting record to ever resume it. Refuse to
        // suspend in that case and close instead, so the run completes honestly rather than
        // leaving a session waiting forever.
        if (!this.suspensionManager) {
          this.logger.error('Pending inquiries detected but no suspension manager is wired; closing instead of orphaning the session', {
            runId: input.runId,
            pendingCount: pendingInquiries.length,
          });
          await this.sessionManager.close(sessionId, 'completed');
          this.updateHandler.removeCallbacks(acpSessionId);
          return this.completedOutput('succeeded', aggregatedText, result, acpSessionId);
        }

        await this.sessionManager.suspend(sessionId, 'collaboration');

        this.suspensionManager.suspend({
          sessionId,
          acpSessionId,
          runId: input.runId,
          roleId: input.roleId,
          orgId: input.orgId,
          taskId: input.taskId || null,
          awaitingInquiries: pendingInquiries,
          aggregationMode: 'all',
        });

        this.logger.info('Run suspended for pending inquiries', {
          runId: input.runId,
          pendingCount: pendingInquiries.length,
        });

        return this.suspendedOutput(acpSessionId, result);
      }

      // Idle suspend (planning keep_alive): the agent-side session stays alive for the next
      // round; from the run's perspective the turn succeeded.
      if (outcome.action === 'suspend') {
        await this.sessionManager.suspend(sessionId, outcome.reason);
        this.updateHandler.removeCallbacks(acpSessionId);
        return this.completedOutput('succeeded', aggregatedText, result, acpSessionId);
      }

      // Close path: genuine termination (task complete or abnormal stop).
      await this.sessionManager.close(sessionId, outcome.reason);
      this.updateHandler.removeCallbacks(acpSessionId);

      const status = result.stopReason === 'end_turn' ? 'succeeded'
        : result.stopReason === 'cancelled' ? 'cancelled'
        : 'failed';

      return this.completedOutput(status, aggregatedText, result, acpSessionId);
    } catch (err) {
      // Drain audit logs even on failure
      await this.flushAuditLogs(acpSessionId, input);
      this.updateHandler.removeCallbacks(acpSessionId);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('ACP prompt execution failed', { sessionId, error: message });

      return {
        status: 'failed',
        summary: null,
        errorMessage: message,
        sessionId: acpSessionId,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      };
    }
  }

  private suspendedOutput(acpSessionId: string, result: PromptResult): ExecutorOutput {
    return {
      status: 'suspended',
      summary: null,
      errorMessage: null,
      sessionId: acpSessionId,
      inputTokens: result.tokensUsed.input,
      outputTokens: result.tokensUsed.output,
      cachedInputTokens: result.tokensUsed.cached,
    };
  }

  private completedOutput(
    status: ExecutorOutput['status'],
    summary: string,
    result: PromptResult,
    acpSessionId: string,
  ): ExecutorOutput {
    return {
      status,
      summary: summary || null,
      errorMessage: status === 'failed' ? `Agent stopped: ${result.stopReason}` : null,
      sessionId: acpSessionId,
      inputTokens: result.tokensUsed.input,
      outputTokens: result.tokensUsed.output,
      cachedInputTokens: result.tokensUsed.cached,
    };
  }

  private async flushAuditLogs(acpSessionId: string, input: ExecutorInput): Promise<void> {
    if (!this.auditRepository) return;
    try {
      if (this.filesystemHandler) {
        const fileAccessLogs = this.filesystemHandler.drainAccessLog();
        if (fileAccessLogs.length > 0) {
          this.auditRepository.insertFileAccessLogs(fileAccessLogs);
        }
      }
      if (this.permissionHandler) {
        const toolCallLogs = this.permissionHandler.drainToolCallLog();
        if (toolCallLogs.length > 0) {
          this.auditRepository.insertToolCallLogs(toolCallLogs);
        }
      }
    } catch (err) {
      this.logger.error('Failed to flush audit logs', {
        acpSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Detect unresolved inquiry conversations initiated by this role during the run.
   * Returns pending inquiries that require suspension.
   */
  private detectPendingInquiries(input: ExecutorInput): PendingInquiry[] {
    if (!this.convRepo || !input.taskId) return [];

    const conversations = this.convRepo.findByTaskId(input.taskId);
    return conversations
      .filter(c =>
        c.type === 'inquiry' &&
        c.initiatorRoleId === input.roleId &&
        (c.state === 'active' || c.state === 'waiting') &&
        c.respondentRoleId !== null,
      )
      .map(c => ({
        conversationId: c.id,
        respondentRoleId: c.respondentRoleId!,
      }));
  }
}
