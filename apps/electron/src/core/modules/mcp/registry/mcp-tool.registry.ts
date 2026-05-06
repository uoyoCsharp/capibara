import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, runId: string) => Promise<unknown>;
}

@injectable()
export class McpToolRegistry {
  private tools = new Map<string, McpToolDefinition>();

  constructor(private readonly logger: ILogger) {}

  register(tool: McpToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.logger.debug('MCP tool registered', { name: tool.name });
  }

  get(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): McpToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async dispatch(toolName: string, params: Record<string, unknown>, runId: string): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.logger.error('MCP dispatch: unknown tool', { toolName, runId });
      throw new Error(`Unknown MCP tool: ${toolName}`);
    }

    // MCP calls are AI-facing contract boundaries — keep at info so they
    // surface by default in dev. Set CAPIBARA_LOG_LEVEL=debug to see full params.
    this.logger.info('MCP tool call started', { toolName, runId });
    this.logger.debug('MCP tool call params', { toolName, runId, params });
    const start = Date.now();

    try {
      const result = await tool.handler(params, runId);
      this.logger.info('MCP tool call completed', { toolName, runId, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      this.logger.error('MCP tool call failed', {
        toolName, runId, durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
