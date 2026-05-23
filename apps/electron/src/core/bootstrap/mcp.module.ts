import { container } from 'tsyringe';
import { MCP_IPC_SERVER_TOKEN, MCP_TOOL_REGISTRY_TOKEN } from '@core/foundation/tokens';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import { McpToolRegistry } from '@core/modules/mcp/registry/mcp-tool.registry';
import { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';
import { createTaskTools } from '@core/modules/mcp/handlers/task-tools';
import { createConversationTools } from '@core/modules/mcp/handlers/conversation-tools';
import { createContextTools } from '@core/modules/mcp/handlers/context-tools';
import { createPlanTreeTools } from '@core/modules/mcp/handlers/plan-tree-tools';

export function registerMcpModule(
  logger: ILogger,
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
  conversationService: ConversationService,
  roleService: RoleService,
  eventPublisher: IEventPublisher,
): { mcpIpcServer: McpIpcServer; mcpToolRegistry: McpToolRegistry } {
  const toolRegistry = new McpToolRegistry(logger);
  const mcpIpcServer = new McpIpcServer(toolRegistry, logger);

  for (const tool of createTaskTools(taskService, taskStateMachine, processEngine)) {
    toolRegistry.register(tool);
  }
  for (const tool of createConversationTools(conversationService)) {
    toolRegistry.register(tool);
  }
  for (const tool of createPlanTreeTools(taskService, processEngine, roleService, conversationService, eventPublisher)) {
    toolRegistry.register(tool);
  }
  for (const tool of createContextTools(taskService, roleService)) {
    toolRegistry.register(tool);
  }

  container.register(MCP_TOOL_REGISTRY_TOKEN, { useValue: toolRegistry });
  container.register(MCP_IPC_SERVER_TOKEN, { useValue: mcpIpcServer });

  return { mcpIpcServer, mcpToolRegistry: toolRegistry };
}
