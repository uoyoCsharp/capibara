export interface McpToolCallInput {
  runId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export type McpToolCallResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

export interface IMcpToolHandler {
  handle(input: McpToolCallInput): Promise<McpToolCallResult>;
}
