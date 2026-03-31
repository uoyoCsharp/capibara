import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { injectable, inject } from 'tsyringe';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import { LOGGER_TOKEN } from '@main/core/tokens.js';
import type { McpToolRegistry } from './mcp-tool-registry.js';

/**
 * Lightweight local HTTP server that relays MCP tool calls from the
 * capibara-mcp-bridge process back to the main Electron process.
 *
 * Binds to 127.0.0.1 only — never exposed to the network.
 */
@injectable()
export class McpIpcServer {
  private server: Server | null = null;
  private port = 0;
  private activeTokens = new Map<string, string>(); // runId → token

  constructor(
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    private readonly toolRegistry: McpToolRegistry,
  ) {}

  async start(): Promise<number> {
    if (this.server) return this.port;

    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.server = srv;
          this.logger.info('MCP IPC server started', { port: this.port });
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind MCP IPC server'));
        }
      });

      srv.on('error', (err) => {
        this.logger.error('MCP IPC server error', { error: String(err) });
        reject(err);
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
      this.logger.info('MCP IPC server stopped');
    }
  }

  getPort(): number {
    return this.port;
  }

  registerToken(runId: string, token: string): void {
    this.activeTokens.set(runId, token);
  }

  revokeToken(runId: string): void {
    this.activeTokens.delete(runId);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/tool-call') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      const body = await this.readBody(req);
      const payload = JSON.parse(body) as {
        runId: string;
        token: string;
        toolName: string;
        arguments: Record<string, unknown>;
      };

      // Validate token
      const expectedToken = this.activeTokens.get(payload.runId);
      if (!expectedToken || expectedToken !== payload.token) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid token' }));
        return;
      }

      // Execute tool call
      const result = await this.toolRegistry.handle({
        runId: payload.runId,
        toolName: payload.toolName,
        arguments: payload.arguments,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.logger.error('MCP IPC request error', { error: String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const MAX_BODY = 1024 * 1024; // 1MB limit

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }
}
