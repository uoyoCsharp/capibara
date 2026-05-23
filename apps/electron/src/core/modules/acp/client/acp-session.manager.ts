import { randomUUID } from 'node:crypto';
import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IAcpSessionManager } from '../interfaces/i-acp-session.manager';
import type { AcpSession, CreateSessionParams, PromptContent, PromptResult, AgentCapabilities } from '../types/acp.types';
import type { AcpAgentSpawner, SessionContext } from './acp-agent.spawner';
import type { AcpUpdateHandler } from '../handlers/acp-update.handler';

/**
 * ACP Session Manager — core component.
 * Manages the lifecycle of all ACP sessions.
 */
export class AcpSessionManager implements IAcpSessionManager {
  private sessions = new Map<string, AcpSession>();
  private activeAcpSessionId: string | null = null;

  constructor(
    private readonly spawner: AcpAgentSpawner,
    private readonly updateHandler: AcpUpdateHandler,
    private readonly logger: ILogger,
  ) {
    // Register session context resolver so spawner can resolve fs/permission contexts
    this.spawner.setSessionContextResolver((acpSessionId: string) => {
      if (acpSessionId === '__current__') {
        // Return the currently active session context
        if (this.activeAcpSessionId) {
          return this.resolveByAcpSessionId(this.activeAcpSessionId);
        }
        return null;
      }
      return this.resolveByAcpSessionId(acpSessionId);
    });
  }

  private resolveByAcpSessionId(acpSessionId: string): SessionContext | null {
    for (const session of this.sessions.values()) {
      if (session.acpSessionId === acpSessionId && session.status === 'active') {
        return {
          sessionId: session.id,
          acpSessionId: session.acpSessionId,
          roleId: session.roleId,
          orgId: session.orgId,
          runId: session.runId,
          cwd: session.cwd,
          allowedPaths: session.allowedPaths,
        };
      }
    }
    return null;
  }

  async createSession(params: CreateSessionParams): Promise<AcpSession> {
    const { agentId, roleId, orgId, runId, cwd, mcpServers, allowedPaths } = params;

    // Get or spawn Agent process
    const agentProcess = await this.spawner.getOrSpawn(agentId);
    const connection = agentProcess.connection!;

    // Create ACP session
    const mcpServerConfigs: acp.McpServerStdio[] = mcpServers.map(s => ({
      name: s.name,
      command: s.command,
      args: s.args,
      env: s.env,
    }));

    const response = await connection.newSession({
      cwd,
      mcpServers: mcpServerConfigs,
    });

    const capabilities = agentProcess.capabilities!;
    const resumeStrategy = capabilities.supportsResume ? 'resume'
      : capabilities.supportsLoad ? 'load'
      : 'rebuild';

    const session: AcpSession = {
      id: randomUUID(),
      acpSessionId: response.sessionId,
      agentId,
      roleId,
      orgId,
      runId,
      status: 'active',
      cwd,
      allowedPaths: allowedPaths ?? null,
      capabilities,
      resumeStrategy,
      resumeCount: 0,
      createdAt: new Date().toISOString(),
      closedAt: null,
    };

    this.sessions.set(session.id, session);
    this.activeAcpSessionId = session.acpSessionId;
    this.logger.info('ACP session created', {
      sessionId: session.id,
      acpSessionId: session.acpSessionId,
      agentId,
      roleId,
    });

    return session;
  }

  async prompt(sessionId: string, content: PromptContent[]): Promise<PromptResult> {
    const session = this.getSession(sessionId);
    const agentProcess = await this.spawner.getOrSpawn(session.agentId);
    const connection = agentProcess.connection!;

    const promptBlocks: acp.ContentBlock[] = content.map(c => c as acp.ContentBlock);

    const response = await connection.prompt({
      sessionId: session.acpSessionId,
      prompt: promptBlocks,
    });

    // Text output collected from update handler
    let textOutput = '';
    // Usage from response directly
    const usage = response.usage;

    return {
      stopReason: response.stopReason,
      textOutput,
      tokensUsed: {
        input: usage?.inputTokens ?? 0,
        output: usage?.outputTokens ?? 0,
        cached: usage?.cachedReadTokens ?? 0,
      },
    };
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    const agentProcess = await this.spawner.getOrSpawn(session.agentId);
    const connection = agentProcess.connection!;

    if (session.resumeStrategy === 'resume') {
      await connection.resumeSession({
        sessionId: session.acpSessionId,
        cwd: session.cwd,
      });
    } else if (session.resumeStrategy === 'load') {
      await connection.loadSession({
        sessionId: session.acpSessionId,
        cwd: session.cwd,
        mcpServers: [],
      });
    } else {
      // rebuild — not yet supported, requires new session + context reconstruction
      this.logger.warn('Rebuild strategy not yet implemented', { sessionId });
    }

    session.status = 'active';
    session.resumeCount += 1;
    this.logger.info('ACP session resumed', { sessionId, strategy: session.resumeStrategy, resumeCount: session.resumeCount });
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    const agentProcess = await this.spawner.getOrSpawn(session.agentId);
    const connection = agentProcess.connection!;

    try {
      await connection.closeSession({ sessionId: session.acpSessionId });
    } catch (err) {
      this.logger.warn('Failed to close ACP session', { sessionId, error: String(err) });
    }

    session.status = 'closed';
    session.closedAt = new Date().toISOString();
    if (this.activeAcpSessionId === session.acpSessionId) {
      this.activeAcpSessionId = null;
    }
    this.logger.info('ACP session closed', { sessionId });
  }

  async cancelPrompt(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    const agentProcess = await this.spawner.getOrSpawn(session.agentId);
    const connection = agentProcess.connection!;

    await connection.cancel({ sessionId: session.acpSessionId });
    this.logger.info('ACP prompt cancelled', { sessionId });
  }

  getAgentCapabilities(agentId: string): AgentCapabilities | null {
    return this.spawner.getCapabilities(agentId);
  }

  getActiveSession(roleId: string, orgId: string): AcpSession | null {
    for (const session of this.sessions.values()) {
      if (session.roleId === roleId && session.orgId === orgId && session.status === 'active') {
        return session;
      }
    }
    return null;
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.status === 'active') {
        try {
          await this.closeSession(session.id);
        } catch {
          // ignore errors during shutdown
        }
      }
    }
    this.sessions.clear();
    await this.spawner.shutdown();
  }

  private getSession(sessionId: string): AcpSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`ACP session not found: ${sessionId}`);
    return session;
  }
}
