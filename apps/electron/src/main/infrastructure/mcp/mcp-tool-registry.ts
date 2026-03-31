import { injectable, inject } from 'tsyringe';
import type { IMcpToolHandler, McpToolCallInput, McpToolCallResult } from '@main/core/interfaces/i-mcp-tool-handler.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import { LOGGER_TOKEN } from '@main/core/tokens.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolCallResult>;

/**
 * Registry for MCP tool handlers. Maps tool names to handler functions.
 * See Architecture §7.3 — MCP Tools (MVP).
 */
@injectable()
export class McpToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  constructor(
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  register(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
    this.logger.debug('MCP tool registered', { toolName });
  }

  async handle(input: McpToolCallInput): Promise<McpToolCallResult> {
    const handler = this.handlers.get(input.toolName);
    if (!handler) {
      return { success: false, error: `Unknown tool: ${input.toolName}` };
    }

    try {
      return await handler(input.arguments);
    } catch (err) {
      this.logger.error('MCP tool call failed', {
        toolName: input.toolName,
        runId: input.runId,
        error: String(err),
      });
      return { success: false, error: String(err) };
    }
  }

  listTools(): string[] {
    return [...this.handlers.keys()];
  }
}
