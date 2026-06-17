import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpTransportType } from '../types/acp.types';

/**
 * Builds MCP server configuration for ACP sessions.
 * Supports both Streamable HTTP and SSE transports.
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
   * @param sessionKey - Internal session ID used as the URL path component for session routing
   * @param transport - Preferred transport type: 'http' (default) or 'sse'
   */
  buildMcpServers(sessionKey: string, transport: McpTransportType = 'http'): acp.McpServer[] {
    if (this.mcpHttpPort === 0) {
      this.logger.warn('MCP HTTP port not set, returning empty MCP servers');
      return [];
    }

    if (transport === 'http') {
      return [
        {
          type: 'http' as const,
          name: 'capibara',
          url: `http://127.0.0.1:${this.mcpHttpPort}/mcp/${sessionKey}`,
          headers: [],
        },
      ];
    }

    return [
      {
        type: 'sse' as const,
        name: 'capibara',
        url: `http://127.0.0.1:${this.mcpHttpPort}/sse`,
        headers: [],
      },
    ];
  }
}
