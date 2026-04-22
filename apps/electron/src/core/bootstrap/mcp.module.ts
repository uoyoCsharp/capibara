import { container } from 'tsyringe';
import { MCP_IPC_SERVER_TOKEN, MCP_TOOL_REGISTRY_TOKEN } from '@core/foundation/tokens';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';
import type { PlanningService } from '@core/modules/planning/planning.service';
import { McpToolRegistry } from '@core/modules/mcp/registry/mcp-tool.registry';
import { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';
import { McpConfigGenerator } from '@core/modules/mcp/config/mcp-config-generator';
import { createTaskTools } from '@core/modules/mcp/handlers/task-tools';
import { createConversationTools } from '@core/modules/mcp/handlers/conversation-tools';
import { createPlanningTools } from '@core/modules/mcp/handlers/planning-tools';
import { createContextTools } from '@core/modules/mcp/handlers/context-tools';

export function registerMcpModule(
  logger: ILogger,
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
  conversationService: ConversationService,
  roleService: RoleService,
  pendingPlanStore: PendingPlanStore,
  planningService: PlanningService,
): { mcpIpcServer: McpIpcServer; mcpToolRegistry: McpToolRegistry; mcpConfigGen: McpConfigGenerator } {
  const toolRegistry = new McpToolRegistry(logger);
  const mcpIpcServer = new McpIpcServer(toolRegistry, logger);
  const mcpConfigGen = new McpConfigGenerator(logger);

  for (const tool of createTaskTools(taskService, taskStateMachine, processEngine)) {
    toolRegistry.register(tool);
  }
  for (const tool of createConversationTools(conversationService)) {
    toolRegistry.register(tool);
  }
  for (const tool of createPlanningTools(pendingPlanStore, planningService)) {
    toolRegistry.register(tool);
  }
  for (const tool of createContextTools(taskService, roleService)) {
    toolRegistry.register(tool);
  }

  container.register(MCP_TOOL_REGISTRY_TOKEN, { useValue: toolRegistry });
  container.register(MCP_IPC_SERVER_TOKEN, { useValue: mcpIpcServer });

  return { mcpIpcServer, mcpToolRegistry: toolRegistry, mcpConfigGen };
}
