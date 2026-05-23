import type { IExecutor, ExecutorHandle, HandleLogCallback } from '@core/modules/execution/interfaces/i-executor';
import type { ExecutorInput, ExecutorOutput } from '@core/modules/execution/types/execution.types';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IAcpSessionManager } from '../interfaces/i-acp-session.manager';
import type { AcpUpdateHandler } from '../handlers/acp-update.handler';
import type { AgentRegistryConfig, PromptContent } from '../types/acp.types';
import type { AcpMcpConfigBuilder } from '../mcp/acp-mcp.config';

/**
 * IExecutor implementation that bridges RunEngine to ACP Session Manager.
 * Keeps the IExecutor interface unchanged, minimizing RunEngine changes.
 */
export class AcpExecutor implements IExecutor {
  constructor(
    private readonly sessionManager: IAcpSessionManager,
    private readonly updateHandler: AcpUpdateHandler,
    private readonly mcpConfigBuilder: AcpMcpConfigBuilder,
    private readonly agentConfig: AgentRegistryConfig,
    private readonly logger: ILogger,
  ) {}

  async spawn(input: ExecutorInput): Promise<ExecutorHandle> {
    // 1. Resolve Agent config
    const agentId = this.agentConfig.defaultAgent;

    // 2. Build MCP server config
    const mcpServers = this.mcpConfigBuilder.buildMcpServers(input);

    // 3. Create ACP session
    const session = await this.sessionManager.createSession({
      agentId,
      roleId: input.roleId,
      orgId: input.orgId,
      runId: input.runId,
      taskId: input.taskId,
      cwd: input.projectDir,
      mcpServers,
      allowedPaths: undefined,
    });

    // 4. Build prompt content
    const content: PromptContent[] = [
      { type: 'text', text: input.prompt },
    ];

    // 5. Execute prompt
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
    try {
      const result = await this.sessionManager.prompt(sessionId, content);

      // Close session
      await this.sessionManager.closeSession(sessionId);
      this.updateHandler.removeCallbacks(acpSessionId);

      const status = result.stopReason === 'end_turn' ? 'succeeded'
        : result.stopReason === 'cancelled' ? 'cancelled'
        : 'failed';

      return {
        exitCode: status === 'succeeded' ? 0 : 1,
        status,
        summary: result.textOutput || null,
        errorMessage: status === 'failed' ? `Agent stopped: ${result.stopReason}` : null,
        model: null,
        sessionId: acpSessionId,
        inputTokens: result.tokensUsed.input,
        outputTokens: result.tokensUsed.output,
        cachedInputTokens: result.tokensUsed.cached,
      };
    } catch (err) {
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
}
