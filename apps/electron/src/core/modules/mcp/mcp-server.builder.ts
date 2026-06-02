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
import { registerTaskTools } from './handlers/task-tools';
import { registerConversationTools } from './handlers/conversation-tools';
import { registerContextTools } from './handlers/context-tools';
import { registerPlanTreeTools } from './handlers/plan-tree-tools';

export interface McpServerDeps {
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

export function buildCapibaraMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({
    name: 'capibara',
    version: '0.3.0',
  });

  registerTools(server, deps);

  return server;
}

function registerTools(server: McpServer, deps: McpServerDeps): void {
  registerTaskTools(server, deps);
  registerConversationTools(server, deps);
  registerContextTools(server, deps);
  registerPlanTreeTools(server, deps);
}

/**
 * Creates a dedicated McpServer instance for an SSE client connection.
 * Each SSE transport needs its own McpServer because the SDK only allows
 * one transport per Protocol instance.
 */
export function createSseMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({
    name: 'capibara',
    version: '0.3.0',
  });

  registerTools(server, deps);

  return server;
}
