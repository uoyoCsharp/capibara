import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

/**
 * Builds MCP server configuration for ACP sessions.
 * Phase 1: HTTP transport — Agent connects directly to MCP Server in main process.
 */
export class AcpMcpConfigBuilder {
  private mcpHttpPort = 0;

  constructor(
    private readonly logger: ILogger,
  ) {}

  /**
   * Set MCP HTTP server port.
   * Called after McpHttpTransportManager.start().
   */
  setHttpPort(port: number): void {
    this.mcpHttpPort = port;
  }

  /**
   * Build MCP server config list for an ACP session.
   * Returns McpServerHttp — Agent connects via HTTP, no subprocess needed.
   */
  buildMcpServers(): acp.McpServer[] {
    if (this.mcpHttpPort === 0) {
      this.logger.warn('MCP HTTP port not set, returning empty MCP servers');
      return [];
    }

    return [
      {
        type: 'http' as const,
        name: 'capibara',
        url: `http://127.0.0.1:${this.mcpHttpPort}/mcp`,
        headers: [],
      },
    ];
  }
}
