import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { McpToolRegistry } from '../registry/mcp-tool.registry';

@injectable()
export class McpIpcServer {
  private registeredTokens = new Map<string, string>();

  constructor(
    private readonly toolRegistry: McpToolRegistry,
    private readonly logger: ILogger,
  ) {}

  registerToken(runId: string, token: string): void {
    this.registeredTokens.set(runId, token);
  }

  revokeToken(runId: string): void {
    this.registeredTokens.delete(runId);
  }

  validateToken(runId: string, token: string): boolean {
    const stored = this.registeredTokens.get(runId);
    return stored === token;
  }

  async handleToolCall(toolName: string, params: Record<string, unknown>, runId: string, token: string): Promise<unknown> {
    if (!this.validateToken(runId, token)) {
      throw new Error('Invalid MCP token');
    }
    return this.toolRegistry.dispatch(toolName, params, runId);
  }

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.toolRegistry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
}
