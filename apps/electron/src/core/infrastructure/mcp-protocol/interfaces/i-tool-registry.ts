import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ToolProvider<TDeps = unknown> = (server: McpServer, deps: TDeps) => void;

export interface IToolRegistry<TDeps = unknown> {
  register(provider: ToolProvider<TDeps>): void;
  registerMany(providers: ReadonlyArray<ToolProvider<TDeps>>): void;
  apply(server: McpServer, deps: TDeps): void;
}
