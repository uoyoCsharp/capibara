export interface McpToolCallInput {
  runId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface IMcpToolHandler {
  handle(input: McpToolCallInput): Promise<McpToolCallResult>;
}
