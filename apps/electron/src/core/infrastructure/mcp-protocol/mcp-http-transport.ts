import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpTransportDiagnostic } from '@core/shared/types';
import type { McpProtocolDeps } from './mcp-server.builder';
import { createSseMcpServer } from './mcp-server.builder';

export interface SessionSlot {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  sessionKey: string;
  createdAt: string;
}

export class McpHttpTransportManager {
  private server: Server | null = null;
  private sseTransport: SSEServerTransport | null = null;
  private sseMcpServer: McpServer | null = null;
  private readonly pool = new Map<string, SessionSlot>();
  private readonly pendingAllocations = new Map<string, Promise<SessionSlot>>();
  private port = 0;
  private lastError: string | null = null;
  private serverFactory: (() => McpServer) | null = null;

  /** Warning threshold for pool size. Logs a warning when exceeded. */
  private static readonly POOL_SIZE_WARNING_THRESHOLD = 50;

  constructor(
    private readonly logger: ILogger,
    private readonly deps: McpProtocolDeps,
  ) { }

  async start(serverFactory: () => McpServer): Promise<number> {
    this.lastError = null;
    this.serverFactory = serverFactory;
    this.pool.clear();

    return new Promise((resolve, reject) => {
      const srv = createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        this.logger.info('MCP request received', { method: req.method, path: url.pathname });

        if (req.method === 'GET' && url.pathname === '/sse') {
          await this.handleSseConnect(req, res);
        } else if (req.method === 'POST' && url.pathname === '/messages') {
          await this.handleSseMessage(req, res);
        } else if (url.pathname.startsWith('/mcp/')) {
          const sessionKey = url.pathname.slice('/mcp/'.length);
          if (!sessionKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing session key in path' }));
            return;
          }
          await this.handlePooledRequest(sessionKey, req, res);
        } else if (url.pathname === '/mcp') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Use /mcp/{sessionKey} for session-routed requests' }));
        } else {
          this.logger.warn('MCP unknown request', { method: req.method, path: url.pathname });
          res.writeHead(404);
          res.end();
        }
      });

      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.server = srv;
          this.logger.info('MCP server started (SSE + Streamable HTTP pool)', { port: this.port });
          void this.probeReady(this.port).then((ok) => {
            if (ok) {
              this.logger.info('MCP readiness probe OK', { port: this.port });
            } else {
              this.lastError = 'Readiness probe failed; server is listening but not answering';
              this.logger.error('MCP readiness probe failed', { port: this.port });
            }
            resolve(this.port);
          });
        } else {
          reject(new Error('Failed to bind MCP server'));
        }
      });

      srv.on('error', reject);
    });
  }

  private async probeReady(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: '{}',
        signal: AbortSignal.timeout(1000),
      });
      return res.status > 0;
    } catch (err) {
      this.lastError = `Readiness probe threw: ${String(err)}`;
      return false;
    }
  }

  private async getOrCreateSlot(sessionKey: string): Promise<SessionSlot> {
    const existing = this.pool.get(sessionKey);
    if (existing) return existing;

    const pending = this.pendingAllocations.get(sessionKey);
    if (pending) return pending;

    const allocation = this.allocateSlot(sessionKey);
    this.pendingAllocations.set(sessionKey, allocation);
    try {
      const slot = await allocation;
      return slot;
    } finally {
      this.pendingAllocations.delete(sessionKey);
    }
  }

  private async allocateSlot(sessionKey: string): Promise<SessionSlot> {
    if (!this.serverFactory) {
      throw new Error('MCP transport not started');
    }

    if (this.pool.size >= McpHttpTransportManager.POOL_SIZE_WARNING_THRESHOLD) {
      this.logger.warn('MCP session pool size exceeds warning threshold', {
        poolSize: this.pool.size,
        threshold: McpHttpTransportManager.POOL_SIZE_WARNING_THRESHOLD,
      });
    }

    const server = this.serverFactory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onerror = (err) => {
      this.lastError = String(err);
      this.logger.error('MCP HTTP transport error', { sessionKey, error: String(err) });
    };
    transport.onclose = () => {
      this.logger.info('MCP HTTP transport closed', { sessionKey });
    };

    await server.connect(transport);

    const slot: SessionSlot = {
      transport,
      server,
      sessionKey,
      createdAt: new Date().toISOString(),
    };
    this.pool.set(sessionKey, slot);
    this.logger.info('MCP session slot allocated', { sessionKey, poolSize: this.pool.size });
    return slot;
  }

  private async handlePooledRequest(sessionKey: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const slot = await this.getOrCreateSlot(sessionKey);
      await slot.transport.handleRequest(req, res);
    } catch (err) {
      this.lastError = String(err);
      this.logger.error('MCP /mcp/{sessionKey} handler threw', { sessionKey, error: String(err) });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal MCP transport error' }));
      }
    }
  }

  releaseSession(sessionKey: string): void {
    const slot = this.pool.get(sessionKey);
    if (!slot) return;
    this.pool.delete(sessionKey);
    slot.transport.close().catch((err) => {
      this.logger.warn('Failed to close MCP transport on release', { sessionKey, error: String(err) });
    });
    slot.server.close().catch((err) => {
      this.logger.warn('Failed to close MCP server on release', { sessionKey, error: String(err) });
    });
    this.logger.info('MCP session slot released', { sessionKey, poolSize: this.pool.size });
  }

  getActiveSessionKeys(): string[] {
    return [...this.pool.keys()];
  }

  stop(): void {
    if (this.server) {
      for (const [key, slot] of this.pool) {
        slot.transport.close().catch(() => {});
        slot.server.close().catch(() => {});
        this.logger.info('MCP session slot released (shutdown)', { sessionKey: key });
      }
      this.pool.clear();
      this.server.close();
      this.server = null;
      this.sseTransport = null;
      this.sseMcpServer = null;
      this.serverFactory = null;
      this.port = 0;
      this.lastError = null;
      this.logger.info('MCP server stopped');
    }
  }

  getPort(): number {
    return this.port;
  }

  getDiagnostic(): McpTransportDiagnostic {
    return {
      listening: this.server !== null,
      port: this.port,
      sseClientConnected: this.sseTransport !== null,
      httpTransportReady: this.serverFactory !== null,
      activeSessionCount: this.pool.size,
      lastError: this.lastError,
    };
  }

  private async handleSseConnect(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.sseTransport) {
      this.logger.info('Closing existing MCP SSE connection for new client');
      try {
        await this.sseMcpServer?.close();
      } catch {
        // ignore close errors on stale transport
      }
      this.sseTransport = null;
      this.sseMcpServer = null;
    }

    this.sseTransport = new SSEServerTransport('/messages', res);
    this.sseMcpServer = createSseMcpServer(this.deps);

    try {
      await this.sseMcpServer.connect(this.sseTransport);
      this.logger.info('MCP SSE client connected', { sessionId: this.sseTransport.sessionId });
    } catch (err) {
      this.logger.error('Failed to connect MCP SSE transport', { error: String(err) });
      this.sseTransport = null;
      this.sseMcpServer = null;
      return;
    }

    const connectedSessionId = this.sseTransport.sessionId;
    res.on('close', () => {
      if (this.sseTransport?.sessionId === connectedSessionId) {
        this.sseTransport = null;
        this.sseMcpServer = null;
      }
      this.logger.info('MCP SSE client disconnected', { sessionId: connectedSessionId });
    });
  }

  private async handleSseMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.sseTransport) {
      await this.sseTransport.handlePostMessage(req, res);
    } else {
      this.logger.warn('MCP POST /messages received without active SSE connection');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active SSE connection' }));
    }
  }
}
