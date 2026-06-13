import { createServer, type Server } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpTransportDiagnostic } from '@core/shared/types';
import type { McpProtocolDeps } from './mcp-server.builder';
import { createSseMcpServer } from './mcp-server.builder';

/**
 * Manages dual-transport (SSE + Streamable HTTP) for the in-process McpServer.
 * Binds to 127.0.0.1 on a random port so ACP agents can connect.
 *
 * - SSE: GET /sse + POST /messages — broad compatibility (Claude Code)
 * - Streamable HTTP: POST /mcp — newer protocol for clients that support it
 *
 * Each SSE client gets its own McpServer instance (the SDK allows only one
 * transport per Protocol instance). Streamable HTTP shares a single transport
 * with session-based multiplexing.
 */
export class McpHttpTransportManager {
  private server: Server | null = null;
  private sseTransport: SSEServerTransport | null = null;
  private sseMcpServer: McpServer | null = null;
  private httpTransport: StreamableHTTPServerTransport | null = null;
  private port = 0;
  /** Most recent transport-level error message. Null if no error has been observed since start. */
  private lastError: string | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly deps: McpProtocolDeps,
  ) { }

  async start(mcpServer: McpServer): Promise<number> {
    this.lastError = null;
    this.httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Surface SDK-internal transport errors instead of letting them vanish. Without
    // these handlers, a parse failure or protocol violation would log nothing and
    // leave the caller (the agent) hanging on a silently-broken socket.
    this.httpTransport.onerror = (err) => {
      this.lastError = String(err);
      this.logger.error('MCP HTTP transport error', { error: String(err) });
    };
    this.httpTransport.onclose = () => {
      this.logger.info('MCP HTTP transport closed');
    };

    await mcpServer.connect(this.httpTransport);

    return new Promise((resolve, reject) => {
      const srv = createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        this.logger.info('MCP request received', { method: req.method, path: url.pathname });

        if (req.method === 'GET' && url.pathname === '/sse') {
          await this.handleSseConnect(req, res);
        } else if (req.method === 'POST' && url.pathname === '/messages') {
          await this.handleSseMessage(req, res);
        } else if (url.pathname === '/mcp') {
          try {
            await this.httpTransport!.handleRequest(req, res);
          } catch (err) {
            // An unhandled throw inside handleRequest would otherwise become an
            // unhandled rejection: the agent never gets a response and reports
            // "cannot connect to MCP". Convert to a logged 500 instead.
            this.lastError = String(err);
            this.logger.error('MCP /mcp handler threw', { error: String(err) });
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Internal MCP transport error' }));
            }
          }
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
          this.logger.info('MCP server started (SSE + Streamable HTTP)', { port: this.port });
          // Local readiness probe — verify the server actually answers a request
          // before resolving. Catches the race where the OS allocated the port
          // but the listener isn't fully accepting yet, and gives us a single
          // log line if anything in the transport pipeline is broken at boot.
          void this.probeReady(this.port).then((ok) => {
            if (ok) {
              this.logger.info('MCP readiness probe OK', { port: this.port });
            } else {
              this.lastError = 'Readiness probe failed; server is listening but not answering /mcp';
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

  /**
   * Lightweight readiness probe against the just-bound HTTP transport. Issues a
   * POST with a malformed JSON-RPC body — the SDK will return 4xx (parse error)
   * but TCP+HTTP must succeed for the server to be considered reachable.
   * Best-effort: any failure is logged via `lastError`, never thrown.
   */
  private async probeReady(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: '{}',
        signal: AbortSignal.timeout(1000),
      });
      // Any HTTP response means the listener accepted the connection and the
      // transport pipeline is wired up. 4xx/5xx from a malformed body is fine.
      return res.status > 0;
    } catch (err) {
      this.lastError = `Readiness probe threw: ${String(err)}`;
      return false;
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.sseTransport = null;
      this.sseMcpServer = null;
      this.httpTransport = null;
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
      httpTransportReady: this.httpTransport !== null,
      lastError: this.lastError,
    };
  }

  private async handleSseConnect(_req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
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

  private async handleSseMessage(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    if (this.sseTransport) {
      await this.sseTransport.handlePostMessage(req, res);
    } else {
      this.logger.warn('MCP POST /messages received without active SSE connection');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active SSE connection' }));
    }
  }
}
