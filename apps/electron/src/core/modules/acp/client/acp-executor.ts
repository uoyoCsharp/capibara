import type { IExecutor, ExecutorHandle, HandleLogCallback } from '@core/modules/execution/interfaces/i-executor';
import type { ExecutorInput, ExecutorOutput } from '@core/modules/execution/types/execution.types';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IAcpSessionManager } from '../interfaces/i-acp-session.manager';
import type { ISessionSuspensionManager } from '../interfaces/i-session-suspension.manager';
import type { AcpUpdateHandler } from '../handlers/acp-update.handler';
import type { AcpFilesystemHandler } from '../handlers/acp-filesystem.handler';
import type { AcpPermissionHandler } from '../handlers/acp-permission.handler';
import type { AcpAuditRepository } from '../persistence/acp-audit.repository';
import type { AgentRegistryConfig, PromptContent } from '../types/acp.types';
import type { AcpMcpConfigBuilder } from '../mcp/acp-mcp.config';
import type { PendingInquiry } from '../collaboration/suspension.types';

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
    // Resume path: if sessionId is provided, resume an existing ACP session
    if (input.sessionId) {
      try {
        return await this.spawnResume(input);
      } catch (err) {
        this.logger.warn('ACP resume failed; falling back to fresh session', {
          runId: input.runId,
          roleId: input.roleId,
          orgId: input.orgId,
          requestedSessionId: input.sessionId,
          error: String(err),
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

    // 2. Build MCP server config
    const mcpServers = this.mcpConfigBuilder.buildMcpServers();

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
      pid: process.pid,
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

    // Resume the ACP session
    await this.sessionManager.resumeSession(session.id);

    // Associate session with run for event emission
    this.updateHandler.setRunId(session.acpSessionId, input.runId);

    // Build prompt content (aggregated reply is in input.prompt)
    const content: PromptContent[] = [
      { type: 'text', text: input.prompt },
    ];

    const completePromise = this.executePrompt(session.id, session.acpSessionId, content, input);

    return {
      runId: input.runId,
      pid: process.pid,
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

      // Check for pending inquiries (AI↔AI collaboration)
      const pendingInquiries = this.detectPendingInquiries(input);
      if (pendingInquiries.length > 0 && this.suspensionManager) {
        // Close the ACP session (preserving state for resume)
        await this.sessionManager.closeSession(sessionId);

        // Create suspension record
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

        return {
          exitCode: 0,
          status: 'suspended',
          summary: null,
          errorMessage: null,
          model: null,
          sessionId: acpSessionId,
          inputTokens: result.tokensUsed.input,
          outputTokens: result.tokensUsed.output,
          cachedInputTokens: result.tokensUsed.cached,
        };
      }

      // Normal completion — close session
      await this.sessionManager.closeSession(sessionId);
      this.updateHandler.removeCallbacks(acpSessionId);

      const status = result.stopReason === 'end_turn' ? 'succeeded'
        : result.stopReason === 'cancelled' ? 'cancelled'
        : 'failed';

      return {
        exitCode: status === 'succeeded' ? 0 : 1,
        status,
        summary: aggregatedText || null,
        errorMessage: status === 'failed' ? `Agent stopped: ${result.stopReason}` : null,
        model: null,
        sessionId: acpSessionId,
        inputTokens: result.tokensUsed.input,
        outputTokens: result.tokensUsed.output,
        cachedInputTokens: result.tokensUsed.cached,
      };
    } catch (err) {
      // Drain audit logs even on failure
      await this.flushAuditLogs(acpSessionId, input);
      this.updateHandler.removeCallbacks(acpSessionId);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('ACP prompt execution failed', { sessionId, error: message });

      return {
        exitCode: 1,
        status: 'failed',
        summary: null,
        errorMessage: message,
        model: null,
        sessionId: acpSessionId,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      };
    }
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
