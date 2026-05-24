/**
 * Test helper for MCP tool handlers registered via McpServer.tool().
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
   * Matches the McpServer.tool() overloaded signatures.
   * Captures the last function argument as the handler.
   */
  tool(...toolArgs: unknown[]): void {
    const name = toolArgs[0] as string;
    // McpServer.tool() has multiple overloads: (name, desc, schema, handler) or (name, desc, handler)
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
