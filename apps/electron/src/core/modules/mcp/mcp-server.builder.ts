import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';
import { registerTaskTools } from './handlers/task-tools';
import { registerConversationTools } from './handlers/conversation-tools';
import { registerContextTools } from './handlers/context-tools';
import { registerPlanTreeTools } from './handlers/plan-tree-tools';

export interface McpServerDeps {
  taskService: TaskService;
  taskStateMachine: TaskStateMachine;
  processEngine: ProcessEngine;
  conversationService: ConversationService;
  roleService: RoleService;
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
