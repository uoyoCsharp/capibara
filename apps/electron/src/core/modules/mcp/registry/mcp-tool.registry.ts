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
      throw new Error(`Unknown MCP tool: ${toolName}`);
    }
    return tool.handler(params, runId);
  }
}
