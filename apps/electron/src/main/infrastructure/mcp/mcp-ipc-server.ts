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
  private activeTokens = new Map<string, { token: string; expiresAt: number }>(); // runId → { token, expiresAt }
  private tokenCleanupTimer: ReturnType<typeof setInterval> | null = null;

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
          this.startTokenCleanup();
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
    if (this.tokenCleanupTimer) {
      clearInterval(this.tokenCleanupTimer);
      this.tokenCleanupTimer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
      this.activeTokens.clear();
      this.logger.info('MCP IPC server stopped');
    }
  }

  getPort(): number {
    return this.port;
  }

  registerToken(runId: string, token: string): void {
    // Parse expiry from JWT payload, fallback to 1 hour
    let expiresAt = Date.now() + 3_600_000;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (payload.exp) {
          expiresAt = payload.exp * 1000;
        }
      }
    } catch {
      // Use default expiry
    }
    this.activeTokens.set(runId, { token, expiresAt });
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

      // Validate JWT token
      if (!this.validateJwt(payload.runId, payload.token)) {
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

  private validateJwt(runId: string, token: string): boolean {
    const entry = this.activeTokens.get(runId);
    if (!entry || entry.token !== token) return false;

    // Check if token has expired
    if (entry.expiresAt < Date.now()) {
      this.activeTokens.delete(runId);
      return false;
    }

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload.sub !== runId) return false;
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Periodically remove expired tokens to prevent memory leaks from orphaned runs */
  private startTokenCleanup(): void {
    this.tokenCleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [runId, entry] of this.activeTokens) {
        if (entry.expiresAt < now) {
          this.activeTokens.delete(runId);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.logger.debug('Cleaned expired MCP tokens', { count: cleaned });
      }
    }, 60_000); // every minute
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
