import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpToolRegistry } from '../registry/mcp-tool.registry';

@injectable()
export class McpIpcServer {
  private server: Server | null = null;
  private port = 0;

  constructor(
    private readonly toolRegistry: McpToolRegistry,
    private readonly logger: ILogger,
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

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.toolRegistry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
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
        toolName: string;
        arguments: Record<string, unknown>;
      };

      this.logger.debug('MCP HTTP tool call', { toolName: payload.toolName });
      const result = await this.toolRegistry.dispatch(payload.toolName, payload.arguments, '');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      this.logger.error('MCP HTTP request error', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const MAX_BODY = 1024 * 1024;

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
