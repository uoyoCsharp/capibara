import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IAcpSessionManager } from '../interfaces/i-acp-session.manager';
import type { IAcpSessionRepository } from '../interfaces/i-acp-session.repository';
import type {
  AcpSessionRecord,
  AgentCapabilities,
  CloseReason,
  CollaborationConfig,
  CreateSessionParams,
  PromptContent,
  PromptResult,
  SuspendReason,
} from '../types/acp.types';
import type { AcpAgentSpawner, SessionContext } from './acp-agent.spawner';
import type { AcpUpdateHandler } from '../handlers/acp-update.handler';
import { assertTransition } from './session-lifecycle';

/** Default idle-TTL applied when CollaborationConfig.sessionTtlMs is not configured. */
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;

/** Default absolute liveness cap for collaboration suspensions when collaborationCapMs is not configured. */
const DEFAULT_COLLABORATION_CAP_MS = 2 * 60 * 60 * 1000;

/**
 * Runtime context for a live agent connection — the non-persistable half of a session.
 * Re-derived on rebuild from role+org config (supplied via {@link AcpSessionManager.setSessionRebuilder}).
 */
export interface SessionRuntimeContext {
  agentId: string;
  cwd: string;
  mcpServers: acp.McpServer[];
  allowedPaths: string[] | null;
  capabilities: AgentCapabilities;
}

/** Re-derives runtime context for a persisted record whose live connection was lost (post-restart). */
export type SessionRebuilder = (record: AcpSessionRecord) => Promise<Omit<SessionRuntimeContext, 'capabilities'>>;

/**
 * ACP Session Manager — core lifecycle component.
 *
 * Owns an explicit state machine (suspend/resume/close/expire) over a persisted repository
 * (the single source of truth for lifecycle status/binding/activity) plus a write-through
 * in-memory cache of live agent connections' runtime context. The agent process owns session
 * *history* content (retrieved via session/load); derivable runtime fields are never persisted.
 */
export class AcpSessionManager implements IAcpSessionManager {
  /** Live runtime context keyed by internal session id; present only while the connection is alive. */
  private live = new Map<string, SessionRuntimeContext>();
  private rebuilder: SessionRebuilder | null = null;

  constructor(
    private readonly repo: IAcpSessionRepository,
    private readonly spawner: AcpAgentSpawner,
    private readonly updateHandler: AcpUpdateHandler,
    private readonly logger: ILogger,
    private readonly collaborationConfig?: CollaborationConfig,
  ) {
    // Spawner fs/permission callbacks resolve context by the in-flight prompt's session id (ADR-4),
    // so this resolver just maps an acpSessionId to its live context — no global "current" sentinel.
    this.spawner.setSessionContextResolver((acpSessionId: string) => this.resolveByAcpSessionId(acpSessionId));
  }

  /** Inject the rebuild context provider (wired by t7/t8 with role+org config). */
  setSessionRebuilder(rebuilder: SessionRebuilder): void {
    this.rebuilder = rebuilder;
  }

  private resolveByAcpSessionId(acpSessionId: string): SessionContext | null {
    const record = this.repo.findByAcpSessionId(acpSessionId);
    if (!record || record.status !== 'active') return null;
    const runtime = this.live.get(record.id);
    if (!runtime) return null;
    return {
      sessionId: record.id,
      acpSessionId: record.acpSessionId,
      roleId: record.roleId,
      orgId: record.orgId,
      runId: record.runId,
      cwd: runtime.cwd,
      allowedPaths: runtime.allowedPaths,
    };
  }

  async createSession(params: CreateSessionParams): Promise<AcpSessionRecord> {
    const { agentId, roleId, orgId, runId, taskId, conversationId, cwd, mcpServers, allowedPaths } = params;

    const agentProcess = await this.spawner.getOrSpawn(agentId);
    const connection = agentProcess.connection!;
    const capabilities = agentProcess.capabilities!;

    const response = await connection.newSession({ cwd, mcpServers });

    const resumeStrategy = capabilities.supportsResume ? 'resume'
      : capabilities.supportsLoad ? 'load'
      : 'rebuild';

    const now = new Date().toISOString();
    const record = this.repo.create({
      acpSessionId: response.sessionId,
      agentId,
      roleId,
      orgId,
      runId,
      conversationId: conversationId ?? null,
      taskId: taskId ?? null,
      status: 'active',
      suspendReason: null,
      resumeStrategy,
      resumeCount: 0,
      lastActivityAt: now,
      closedAt: null,
      closeReason: null,
    });

    this.live.set(record.id, { agentId, cwd, mcpServers, allowedPaths: allowedPaths ?? null, capabilities });
    this.logger.info('ACP session created', {
      sessionId: record.id,
      acpSessionId: record.acpSessionId,
      agentId,
      roleId,
    });

    return record;
  }

  async prompt(sessionId: string, content: PromptContent[]): Promise<PromptResult> {
    const record = this.getRecord(sessionId);
    const runtime = this.requireLive(sessionId);
    const agentProcess = await this.spawner.getOrSpawn(runtime.agentId);
    const connection = agentProcess.connection!;

    // Mark this session as the in-flight prompt on its agent connection so fs/permission
    // callbacks resolve the correct context (ADR-4). Cleared once the turn completes.
    this.spawner.setInFlightSession(runtime.agentId, record.acpSessionId);
    const promptBlocks: acp.ContentBlock[] = content.map(c => c as acp.ContentBlock);
    try {
      const response = await connection.prompt({ sessionId: record.acpSessionId, prompt: promptBlocks });
      this.repo.touchActivity(sessionId, new Date().toISOString());

      const usage = response.usage;
      return {
        stopReason: response.stopReason,
        textOutput: '',
        tokensUsed: {
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          cached: usage?.cachedReadTokens ?? 0,
        },
      };
    } finally {
      this.spawner.setInFlightSession(runtime.agentId, null);
    }
  }

  async suspend(sessionId: string, reason: SuspendReason): Promise<void> {
    const record = this.getRecord(sessionId);
    assertTransition(record.status, 'suspended');
    // No protocol closeSession (ADR-3): the agent-side session stays alive for in-run resume.
    this.repo.updateStatus(sessionId, 'suspended', {
      suspendReason: reason,
      lastActivityAt: new Date().toISOString(),
    });
    this.logger.info('ACP session suspended', { sessionId, reason });
  }

  async resume(sessionId: string): Promise<void> {
    const record = this.getRecord(sessionId);
    assertTransition(record.status, 'active');

    const runtime = this.live.get(sessionId);
    // No live connection (post-restart) or the agent can no longer resume → rebuild.
    if (!runtime || record.resumeStrategy === 'rebuild' || record.status === 'expired') {
      await this.rebuild(record);
    } else {
      const agentProcess = await this.spawner.getOrSpawn(runtime.agentId);
      const connection = agentProcess.connection!;
      if (record.resumeStrategy === 'resume') {
        await connection.resumeSession({ sessionId: record.acpSessionId, cwd: runtime.cwd });
      } else {
        await connection.loadSession({
          sessionId: record.acpSessionId,
          cwd: runtime.cwd,
          mcpServers: runtime.mcpServers,
        });
      }
    }

    this.repo.updateStatus(sessionId, 'active', {
      suspendReason: null,
      resumeCount: record.resumeCount + 1,
      lastActivityAt: new Date().toISOString(),
    });
    this.logger.info('ACP session resumed', {
      sessionId,
      strategy: record.resumeStrategy,
      resumeCount: record.resumeCount + 1,
    });
  }

  /**
   * Rebuild a session whose agent-side counterpart is gone (ADR-6): re-derive runtime context,
   * open a fresh agent session, and re-point the record at the new acpSessionId. Conversational
   * context reconstruction (PromptBuilder forceFullContext) is the caller's responsibility (t8);
   * this restores the session channel only.
   */
  private async rebuild(record: AcpSessionRecord): Promise<void> {
    let runtime = this.live.get(record.id);
    if (!runtime) {
      if (!this.rebuilder) {
        throw new Error(`Cannot rebuild ACP session ${record.id}: no live context and no rebuilder configured`);
      }
      const derived = await this.rebuilder(record);
      const agentProcess = await this.spawner.getOrSpawn(derived.agentId);
      runtime = { ...derived, capabilities: agentProcess.capabilities! };
    }

    const agentProcess = await this.spawner.getOrSpawn(runtime.agentId);
    const connection = agentProcess.connection!;
    const response = await connection.newSession({ cwd: runtime.cwd, mcpServers: runtime.mcpServers });

    this.live.set(record.id, runtime);
    this.repo.updateStatus(record.id, record.status === 'expired' ? 'active' : record.status, {
      acpSessionId: response.sessionId,
    });
    this.logger.info('ACP session rebuilt', {
      sessionId: record.id,
      oldAcpSessionId: record.acpSessionId,
      newAcpSessionId: response.sessionId,
    });
  }

  async close(sessionId: string, reason: CloseReason): Promise<void> {
    const record = this.getRecord(sessionId);
    assertTransition(record.status, 'closed');
    await this.protocolClose(record);
    this.repo.updateStatus(sessionId, 'closed', {
      closeReason: reason,
      closedAt: new Date().toISOString(),
    });
    this.evict(sessionId);
    this.logger.info('ACP session closed', { sessionId, reason });
  }

  async expire(sessionId: string): Promise<void> {
    const record = this.getRecord(sessionId);
    assertTransition(record.status, 'expired');
    await this.protocolClose(record);
    this.repo.updateStatus(sessionId, 'expired', { lastActivityAt: new Date().toISOString() });
    this.evict(sessionId);
    this.logger.info('ACP session expired', { sessionId });
  }

  async reconcileOnStartup(): Promise<void> {
    // Agent subprocesses died with the previous app process, so every persisted non-terminal
    // session is stale. Mark them expired directly (bypassing the live state machine — the
    // active→expired edge is illegal for live transitions but correct for crash recovery).
    // Rebuild happens lazily on next use; no eager reconnect.
    const stale = this.repo.findNonTerminal();
    for (const record of stale) {
      this.repo.updateStatus(record.id, 'expired', { lastActivityAt: record.lastActivityAt });
    }
    if (stale.length > 0) {
      this.logger.info('Reconciled stale ACP sessions on startup', { count: stale.length });
    }
  }

  async sweepIdle(nowIso: string): Promise<void> {
    const now = new Date(nowIso).getTime();
    const ttlMs = this.collaborationConfig?.sessionTtlMs ?? DEFAULT_IDLE_TTL_MS;
    const capMs = this.collaborationConfig?.collaborationCapMs ?? DEFAULT_COLLABORATION_CAP_MS;

    // Idle suspensions reclaimed past the idle TTL; collaboration suspensions are TTL-exempt and
    // only reclaimed past the (much larger) absolute liveness cap (ADR-5/ADR-7).
    const idleCutoff = new Date(now - ttlMs).toISOString();
    const collaborationCutoff = new Date(now - capMs).toISOString();
    const expired = [
      ...this.repo.findIdleExpired(idleCutoff),
      ...this.repo.findCollaborationExpired(collaborationCutoff),
    ];

    for (const record of expired) {
      try {
        await this.expire(record.id);
      } catch (err) {
        this.logger.warn('Failed to expire session during sweep', { sessionId: record.id, error: String(err) });
      }
    }
    if (expired.length > 0) {
      this.logger.info('ACP session sweep complete', { expired: expired.length });
    }
  }

  async cancelPrompt(sessionId: string): Promise<void> {
    const record = this.getRecord(sessionId);
    const runtime = this.requireLive(sessionId);
    const agentProcess = await this.spawner.getOrSpawn(runtime.agentId);
    await agentProcess.connection!.cancel({ sessionId: record.acpSessionId });
    this.logger.info('ACP prompt cancelled', { sessionId });
  }

  getAgentCapabilities(agentId: string): AgentCapabilities | null {
    return this.spawner.getCapabilities(agentId);
  }

  getActiveSession(roleId: string, orgId: string): AcpSessionRecord | null {
    const record = this.repo.findResumable(roleId, orgId);
    return record && record.status === 'active' ? record : null;
  }

  findByAcpSessionId(acpSessionId: string): AcpSessionRecord | null {
    return this.repo.findByAcpSessionId(acpSessionId);
  }

  async shutdown(): Promise<void> {
    // Leave persisted records non-terminal so reconcileOnStartup expires them next launch.
    this.live.clear();
    await this.spawner.shutdown();
  }

  // ── Internals ──

  private async protocolClose(record: AcpSessionRecord): Promise<void> {
    const runtime = this.live.get(record.id);
    if (!runtime) return; // No live connection (e.g. post-restart) — nothing to close on the agent.
    try {
      const agentProcess = await this.spawner.getOrSpawn(runtime.agentId);
      await agentProcess.connection!.closeSession({ sessionId: record.acpSessionId });
    } catch (err) {
      this.logger.warn('Failed to close ACP session on agent', { sessionId: record.id, error: String(err) });
    }
  }

  private evict(sessionId: string): void {
    this.live.delete(sessionId);
  }

  private getRecord(sessionId: string): AcpSessionRecord {
    const record = this.repo.findById(sessionId);
    if (!record) throw new Error(`ACP session not found: ${sessionId}`);
    return record;
  }

  private requireLive(sessionId: string): SessionRuntimeContext {
    const runtime = this.live.get(sessionId);
    if (!runtime) throw new Error(`ACP session has no live connection: ${sessionId}`);
    return runtime;
  }
}
