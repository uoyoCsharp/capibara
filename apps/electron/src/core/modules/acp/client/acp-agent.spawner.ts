import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { AgentRegistryEntry, AgentCapabilities, AgentProcess, AgentRegistryConfig } from '../types/acp.types';
import type { AcpUpdateHandler } from '../handlers/acp-update.handler';
import type { AcpPermissionHandler } from '../handlers/acp-permission.handler';
import type { AcpFilesystemHandler } from '../handlers/acp-filesystem.handler';

export interface SessionContext {
  sessionId: string;
  acpSessionId: string;
  roleId: string;
  orgId: string;
  runId: string | null;
  cwd: string;
  allowedPaths: string[] | null;
}

/**
 * Manages ACP Agent subprocess lifecycle.
 * Each registered Agent config maps to a single reusable subprocess.
 */
export class AcpAgentSpawner {
  private processes = new Map<string, AgentProcess>();
  private filesystemHandler: AcpFilesystemHandler | null = null;
  /** Resolve session context by its ACP session id. Set by AcpSessionManager. */
  private sessionContextResolver: ((acpSessionId: string) => SessionContext | null) | null = null;
  /** ACP session id of the prompt currently in flight on each agent connection (ADR-4). */
  private inFlightByAgent = new Map<string, string>();
  private shuttingDown = false;

  constructor(
    private readonly config: AgentRegistryConfig,
    private readonly updateHandler: AcpUpdateHandler,
    private readonly permissionHandler: AcpPermissionHandler,
    private readonly logger: ILogger,
  ) {}

  /**
   * Set the filesystem handler for Phase 2 file access control.
   */
  setFilesystemHandler(handler: AcpFilesystemHandler): void {
    this.filesystemHandler = handler;
  }

  /**
   * Set a resolver that maps an ACP session id to its session context (roleId, cwd, allowedPaths).
   */
  setSessionContextResolver(resolver: (acpSessionId: string) => SessionContext | null): void {
    this.sessionContextResolver = resolver;
  }

  /**
   * Record (or clear) the ACP session id whose prompt is currently in flight on the given agent
   * connection. fs/permission callbacks — which carry no session id — resolve their context
   * against this per-connection value instead of a global "current session" sentinel (ADR-4).
   */
  setInFlightSession(agentId: string, acpSessionId: string | null): void {
    if (acpSessionId === null) {
      this.inFlightByAgent.delete(agentId);
    } else {
      this.inFlightByAgent.set(agentId, acpSessionId);
    }
  }

  /**
   * Resolve the session context for the prompt in flight on the given agent connection.
   * Exactly one prompt is in flight per connection at a time, so this is unambiguous.
   */
  private resolveInFlightContext(agentId: string): SessionContext | null {
    if (!this.sessionContextResolver) return null;
    const acpSessionId = this.inFlightByAgent.get(agentId);
    if (!acpSessionId) return null;
    return this.sessionContextResolver(acpSessionId);
  }

  /**
   * Get or spawn an Agent process and return the AgentProcess with its ClientSideConnection.
   */
  async getOrSpawn(agentId: string): Promise<AgentProcess> {
    const existing = this.processes.get(agentId);
    if (existing && !existing.exited) return existing;

    const entry = this.config.registry.find(a => a.id === agentId);
    if (!entry) {
      const available = this.config.registry.map((a) => a.id).join(', ');
      throw new Error(`Agent not registered: ${agentId}; available: [${available}]`);
    }

    const child = spawn(entry.command, entry.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...entry.env },
      windowsHide: true,
    });

    const agentProcess: AgentProcess = {
      agentId,
      child,
      exited: false,
      capabilities: null,
      connection: null,
    };

    child.on('exit', (code) => {
      agentProcess.exited = true;
      this.processes.delete(agentId);
      this.inFlightByAgent.delete(agentId);
      if (!this.shuttingDown) {
        this.logger.info('Agent process exited', { agentId, code });
      }
    });

    child.on('error', (err) => {
      agentProcess.exited = true;
      this.processes.delete(agentId);
      this.inFlightByAgent.delete(agentId);
      if (!this.shuttingDown) {
        this.logger.error('Agent process error', { agentId, error: String(err) });
      }
    });

    // stderr → log
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!this.shuttingDown) {
        this.logger.debug('Agent stderr', { agentId, data: chunk.toString('utf-8').slice(0, 500) });
      }
    });

    // Create ACP connection
    const input = Writable.toWeb(child.stdin!);
    const output = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    const connection = new acp.ClientSideConnection((_agent) => {
      return {
        sessionUpdate: async (params: acp.SessionNotification) => {
          this.updateHandler.handleUpdate(params.sessionId, params.update);
        },
        requestPermission: async (params: acp.RequestPermissionRequest) => {
          // Resolve context for the prompt in flight on THIS agent connection (ADR-4).
          const ctx = this.resolveInFlightContext(agentId);
          if (ctx) {
            return this.permissionHandler.handlePermissionRequest(
              params,
              { roleId: ctx.roleId, orgId: ctx.orgId },
              ctx.sessionId,
              ctx.runId,
            );
          }
          return this.permissionHandler.handlePermissionRequest(params);
        },
        readTextFile: async (params: acp.ReadTextFileRequest) => {
          if (!this.filesystemHandler || !this.sessionContextResolver) {
            return { content: '' };
          }
          // ACP readTextFile carries no sessionId; resolve via the in-flight prompt on this connection.
          const ctx = this.resolveInFlightContext(agentId);
          if (!ctx) {
            this.logger.warn('No session context for readTextFile', { path: params.path });
            return { content: '' };
          }
          const result = await this.filesystemHandler.handleReadFile(
            ctx.sessionId,
            { roleId: ctx.roleId, cwd: ctx.cwd, allowedPaths: ctx.allowedPaths },
            { path: params.path },
          );
          if ('error' in result) {
            return { content: '' };
          }
          return { content: result.content };
        },
        writeTextFile: async (params: acp.WriteTextFileRequest) => {
          if (!this.filesystemHandler || !this.sessionContextResolver) {
            return {};
          }
          const ctx = this.resolveInFlightContext(agentId);
          if (!ctx) {
            this.logger.warn('No session context for writeTextFile', { path: params.path });
            return {};
          }
          await this.filesystemHandler.handleWriteFile(
            ctx.sessionId,
            { roleId: ctx.roleId, cwd: ctx.cwd, allowedPaths: ctx.allowedPaths },
            { path: params.path, content: params.content },
          );
          return {};
        },
      };
    }, stream);

    agentProcess.connection = connection;

    // ACP initialize handshake
    agentProcess.capabilities = await this.initialize(connection, entry);

    this.processes.set(agentId, agentProcess);
    this.logger.info('Agent process spawned', {
      agentId,
      pid: child.pid,
      capabilities: agentProcess.capabilities,
    });

    return agentProcess;
  }

  private async initialize(
    connection: acp.ClientSideConnection,
    entry: AgentRegistryEntry,
  ): Promise<AgentCapabilities> {
    const response = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });

    const caps = response.agentCapabilities ?? {};
    const sessionCaps = caps.sessionCapabilities;

    // Config overrides take priority
    const supportsResume = entry.capabilities?.supportsResume
      ?? !!sessionCaps?.resume;
    const supportsLoad = entry.capabilities?.supportsLoad
      ?? !!caps.loadSession;
    const supportsList = !!sessionCaps?.list;

    const mcpCaps = caps.mcpCapabilities;
    const transports: ('stdio' | 'sse')[] = [];
    // McpCapabilities has http/sse/acp fields — stdio is implied as default
    if (mcpCaps?.http) transports.push('sse');
    if (mcpCaps?.sse) transports.push('sse');
    if (transports.length === 0) transports.push('stdio'); // default to stdio

    return { supportsResume, supportsLoad, supportsList, supportedMcpTransports: transports };
  }

  /**
   * Get capabilities for a registered Agent.
   */
  getCapabilities(agentId: string): AgentCapabilities | null {
    return this.processes.get(agentId)?.capabilities ?? null;
  }

  /**
   * Terminate all Agent processes.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const [agentId, proc] of this.processes) {
      if (!proc.exited) {
        proc.child.kill('SIGTERM');
      }
    }
    this.processes.clear();
    this.inFlightByAgent.clear();
  }
}
