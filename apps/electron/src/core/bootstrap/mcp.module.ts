import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';
import { buildCapibaraMcpServer } from '@core/modules/mcp/mcp-server.builder';
import { McpHttpTransportManager } from '@core/modules/mcp/mcp-http-transport';

export function registerMcpModule(
  logger: ILogger,
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
  conversationService: ConversationService,
  roleService: RoleService,
  eventPublisher: IEventPublisher,
  suspensionManager?: ISessionSuspensionManager | null,
  collaborationConfig?: CollaborationConfig | null,
): { mcpServer: McpServer; mcpTransport: McpHttpTransportManager } {
  const mcpServer = buildCapibaraMcpServer({
    taskService,
    taskStateMachine,
    processEngine,
    conversationService,
    roleService,
    eventPublisher,
    suspensionManager,
    collaborationConfig,
  });

  const mcpTransport = new McpHttpTransportManager(logger);

  return { mcpServer, mcpTransport };
}
