import { join } from 'node:path';
import { app } from 'electron';
import type * as acp from '@agentclientprotocol/sdk';
import type { ExecutorInput } from '@core/modules/execution/types/execution.types';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

/**
 * Builds MCP server configuration for ACP sessions.
 * Replaces the old McpConfigGenerator (no more temp file generation).
 * MCP server config is passed directly to the Agent via session/new.
 */
export class AcpMcpConfigBuilder {
  private mcpIpcPort = 0;

  constructor(
    private readonly logger: ILogger,
  ) {}

  /**
   * Set MCP IPC server port.
   * Called after McpIpcServer.start().
   */
  setIpcPort(port: number): void {
    this.mcpIpcPort = port;
  }

  /**
   * Get the path to the stdio MCP server (bridge).
   */
  private getBridgePath(): string {
    const basePath = app.isPackaged
      ? app.getAppPath().replace('app.asar', 'app.asar.unpacked')
      : app.getAppPath();
    return join(basePath, 'out', 'main', 'capibara-mcp-server.js');
  }

  /**
   * Build MCP server config list for an ACP session.
   * Returns McpServerStdio config; the Agent will spawn and connect to this MCP server via stdio.
   */
  buildMcpServers(_input: ExecutorInput): acp.McpServerStdio[] {
    if (this.mcpIpcPort === 0) {
      this.logger.warn('MCP IPC port not set, returning empty MCP servers');
      return [];
    }

    return [
      {
        name: 'capibara',
        command: 'node',
        args: [this.getBridgePath(), `--port=${this.mcpIpcPort}`],
        env: [],
      },
    ];
  }
}
