/**
 * Test helper for MCP tool handlers registered via McpServer.registerTool().
 * Captures the handlers so tests can call them directly without a real transport.
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class MockMcpServer {
  private handlers = new Map<string, ToolHandler>();

  /**
   * Matches McpServer.registerTool(name, config, handler) signature.
   * Captures the handler callback for direct invocation in tests.
   */
  registerTool(name: string, _config: unknown, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * @deprecated Use registerTool() instead. Kept for backward compatibility.
   */
  tool(...toolArgs: unknown[]): void {
    const name = toolArgs[0] as string;
    const handler = toolArgs[toolArgs.length - 1] as ToolHandler;
    this.handlers.set(name, handler);
  }

  getHandler(name: string): ToolHandler {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Tool "${name}" not registered`);
    return handler;
  }

  getToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Parse the JSON text from a tool result's first content block.
 */
export function parseToolResult(result: unknown): { data: unknown; isError: boolean } {
  const r = result as ToolCallResult;
  const text = r.content?.[0]?.text;
  return {
    data: text ? JSON.parse(text) : undefined,
    isError: r.isError ?? false,
  };
}
