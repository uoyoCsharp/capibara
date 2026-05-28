import { createServer, type Server } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpServerDeps } from './mcp-server.builder';
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

  constructor(
    private readonly logger: ILogger,
    private readonly deps: McpServerDeps,
  ) { }

  async start(mcpServer: McpServer): Promise<number> {
    this.httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

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
          await this.httpTransport!.handleRequest(req, res);
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
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind MCP server'));
        }
      });

      srv.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.sseTransport = null;
      this.sseMcpServer = null;
      this.httpTransport = null;
      this.port = 0;
      this.logger.info('MCP server stopped');
    }
  }

  getPort(): number {
    return this.port;
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
