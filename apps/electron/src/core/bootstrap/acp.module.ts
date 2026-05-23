import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { AgentRegistryConfig } from '@core/modules/acp/types/acp.types';
import { AcpAgentSpawner } from '@core/modules/acp/client/acp-agent.spawner';
import { AcpSessionManager } from '@core/modules/acp/client/acp-session.manager';
import { AcpExecutor } from '@core/modules/acp/client/acp-executor';
import { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import { AcpFilesystemHandler } from '@core/modules/acp/handlers/acp-filesystem.handler';
import { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import { DefaultFileAccessPolicy } from '@core/modules/acp/policies/file-access.policy';
import { ToolPermissionPolicy } from '@core/modules/acp/policies/tool-permission.policy';
import { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';

export interface AcpModule {
  sessionManager: AcpSessionManager;
  executor: AcpExecutor;
  updateHandler: AcpUpdateHandler;
  permissionHandler: AcpPermissionHandler;
  filesystemHandler: AcpFilesystemHandler;
  mcpConfigBuilder: AcpMcpConfigBuilder;
  spawner: AcpAgentSpawner;
  fileAccessPolicy: DefaultFileAccessPolicy;
  toolPermissionPolicy: ToolPermissionPolicy;
  auditRepository: AcpAuditRepository;
}

export function registerAcpModule(
  eventBus: IEventBus,
  logger: ILogger,
  agentConfig: AgentRegistryConfig,
  sqliteConn: ISqliteConnection,
  roleRepo: IRoleRepository,
): AcpModule {
  // Policies
  const fileAccessPolicy = new DefaultFileAccessPolicy(agentConfig.globalFilePolicy.denyPatterns);
  const toolPermissionPolicy = new ToolPermissionPolicy(roleRepo);

  // Handlers
  const updateHandler = new AcpUpdateHandler(eventBus, logger);
  const permissionHandler = new AcpPermissionHandler(logger);
  permissionHandler.setToolPolicy(toolPermissionPolicy);
  const filesystemHandler = new AcpFilesystemHandler(fileAccessPolicy, logger);

  // Persistence
  const auditRepository = new AcpAuditRepository(sqliteConn);

  // Client
  const mcpConfigBuilder = new AcpMcpConfigBuilder(logger);
  const spawner = new AcpAgentSpawner(agentConfig, updateHandler, permissionHandler, logger);
  spawner.setFilesystemHandler(filesystemHandler);
  const sessionManager = new AcpSessionManager(spawner, updateHandler, logger);
  const executor = new AcpExecutor(sessionManager, updateHandler, mcpConfigBuilder, agentConfig, logger);

  return {
    sessionManager,
    executor,
    updateHandler,
    permissionHandler,
    filesystemHandler,
    mcpConfigBuilder,
    spawner,
    fileAccessPolicy,
    toolPermissionPolicy,
    auditRepository,
  };
}
