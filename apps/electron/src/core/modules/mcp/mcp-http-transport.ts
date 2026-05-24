import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

/**
 * Manages an HTTP transport for the in-process McpServer.
 * Binds to 127.0.0.1 on a random port so ACP agents can connect via HTTP.
 */
export class McpHttpTransportManager {
  private server: Server | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private port = 0;

  constructor(private readonly logger: ILogger) {}

  async start(mcpServer: McpServer): Promise<number> {
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await mcpServer.connect(this.transport);

    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.transport!.handleRequest(req, res);
      });

      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.server = srv;
          this.logger.info('MCP HTTP server started (SDK)', { port: this.port });
          resolve(this.port);
        } else {
          reject(new Error('Failed to bind MCP HTTP server'));
        }
      });

      srv.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.transport = null;
      this.port = 0;
      this.logger.info('MCP HTTP server stopped');
    }
  }

  getPort(): number {
    return this.port;
  }
}
