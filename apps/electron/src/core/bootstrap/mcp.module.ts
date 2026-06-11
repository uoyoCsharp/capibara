import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskService } from '@core/modules/workflow/interfaces/i-task.service';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { IRoleQueryService } from '@core/modules/organization/interfaces/i-role-query.service';
import type { IPlanningService } from '@core/modules/planning/interfaces/i-planning.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';
import { buildCapibaraMcpServer, type McpServerDeps } from '@core/infrastructure/mcp-protocol/mcp-server.builder';
import { McpHttpTransportManager } from '@core/infrastructure/mcp-protocol/mcp-http-transport';

export interface McpModule {
  mcpServer: McpServer;
  mcpTransport: McpHttpTransportManager;
}

export function registerMcpModule(
  logger: ILogger,
  taskService: ITaskService,
  taskStateMachine: ITaskStateMachine,
  processEngine: IProcessEngine,
  conversationService: IConversationCommandService,
  roleService: IRoleQueryService,
  planningService: IPlanningService,
  eventPublisher: IEventPublisher,
  suspensionManager?: ISessionSuspensionManager | null,
  collaborationConfig?: CollaborationConfig | null,
): McpModule {
  const deps: McpServerDeps = {
    taskService,
    taskStateMachine,
    processEngine,
    conversationService,
    roleService,
    planningService,
    eventPublisher,
    suspensionManager,
    collaborationConfig,
  };

  const mcpServer = buildCapibaraMcpServer(deps);

  const mcpTransport = new McpHttpTransportManager(logger, deps);

  return { mcpServer, mcpTransport };
}
