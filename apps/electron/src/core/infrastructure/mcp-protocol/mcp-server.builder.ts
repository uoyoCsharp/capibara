import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ITaskService } from '@core/modules/workflow/interfaces/i-task.service';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { IRoleQueryService } from '@core/modules/organization/interfaces/i-role-query.service';
import type { IPlanningService } from '@core/modules/planning/interfaces/i-planning.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';
import { registerTaskToolProvider } from '@core/mcp/providers/task-tool.provider';
import { registerConversationToolProvider } from '@core/mcp/providers/conversation-tool.provider';
import { registerContextToolProvider } from '@core/mcp/providers/context-tool.provider';
import { registerPlanTreeToolProvider } from '@core/mcp/providers/plan-tree-tool.provider';
import type { IToolRegistry, ToolProvider } from './interfaces/i-tool-registry';

export interface McpProtocolDeps {
  taskService: ITaskService;
  taskStateMachine: ITaskStateMachine;
  processEngine: IProcessEngine;
  conversationService: IConversationCommandService;
  roleService: IRoleQueryService;
  planningService: IPlanningService;
  eventPublisher: IEventPublisher;
  suspensionManager?: ISessionSuspensionManager | null;
  collaborationConfig?: CollaborationConfig | null;
}

// Backward-compatible alias for existing production consumers.
export type McpServerDeps = McpProtocolDeps;

class ToolRegistry<TDeps> implements IToolRegistry<TDeps> {
  private readonly providers: Array<ToolProvider<TDeps>> = [];

  register(provider: ToolProvider<TDeps>): void {
    this.providers.push(provider);
  }

  registerMany(providers: ReadonlyArray<ToolProvider<TDeps>>): void {
    this.providers.push(...providers);
  }

  apply(server: McpServer, deps: TDeps): void {
    for (const provider of this.providers) {
      provider(server, deps);
    }
  }
}

function registerProviders(server: McpServer, deps: McpProtocolDeps): void {
  const toolRegistry = new ToolRegistry<McpProtocolDeps>();
  toolRegistry.registerMany([
    registerTaskToolProvider,
    registerConversationToolProvider,
    registerContextToolProvider,
    registerPlanTreeToolProvider,
  ]);
  toolRegistry.apply(server, deps);
}

export function buildCapibaraMcpServer(deps: McpProtocolDeps): McpServer {
  const server = new McpServer({
    name: 'capibara',
    version: '0.3.0',
  });

  registerProviders(server, deps);

  return server;
}

/**
 * Creates a dedicated McpServer instance for an SSE client connection.
 * Each SSE transport needs its own McpServer because the SDK only allows
 * one transport per Protocol instance.
 */
export function createSseMcpServer(deps: McpProtocolDeps): McpServer {
  const server = new McpServer({
    name: 'capibara',
    version: '0.3.0',
  });

  registerProviders(server, deps);

  return server;
}
