import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { AgentRegistryConfig, CollaborationConfig } from '@core/modules/acp/types/acp.types';
import { AcpAgentSpawner } from '@core/infrastructure/acp-protocol/acp-agent.spawner';
import { AcpSessionManager } from '@core/infrastructure/acp-protocol/acp-session.manager';
import { AcpSessionSweeper } from '@core/infrastructure/acp-protocol/acp-session.sweeper';
import { AcpExecutor } from '@core/infrastructure/acp-protocol/acp-executor';
import { AcpUpdateHandler } from '@core/modules/acp/handlers/acp-update.handler';
import { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import { AcpFilesystemHandler } from '@core/modules/acp/handlers/acp-filesystem.handler';
import { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import { DefaultFileAccessPolicy } from '@core/modules/acp/policies/file-access.policy';
import { ToolPermissionPolicy } from '@core/modules/acp/policies/tool-permission.policy';
import { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';
import { SqliteSuspensionRepository } from '@core/modules/acp/persistence/sqlite-suspension.repository';
import { SqliteAcpSessionRepository } from '@core/modules/acp/persistence/sqlite-acp-session.repository';
import { SqliteModelPreferenceStore } from '@core/modules/acp/persistence/sqlite-model-preference.store';
import { SessionSuspensionManager } from '@core/modules/acp/collaboration/session-suspension.manager';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';

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
  suspensionRepository: SqliteSuspensionRepository;
  sessionRepository: SqliteAcpSessionRepository;
  suspensionManager: ISessionSuspensionManager;
  sessionSweeper: AcpSessionSweeper;
}

export function registerAcpModule(
  eventBus: IEventBus,
  logger: ILogger,
  agentConfig: AgentRegistryConfig,
  sqliteConn: ISqliteConnection,
  roleRepo: IRoleRepository,
  collaborationConfig?: CollaborationConfig,
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
  const suspensionRepo = new SqliteSuspensionRepository(sqliteConn);
  const sessionRepo = new SqliteAcpSessionRepository(sqliteConn);
  const modelPreferenceStore = new SqliteModelPreferenceStore(sqliteConn);

  // Collaboration
  const suspensionManager = new SessionSuspensionManager(suspensionRepo, logger, collaborationConfig);

  // Client
  const mcpConfigBuilder = new AcpMcpConfigBuilder(logger);
  const spawner = new AcpAgentSpawner(agentConfig, updateHandler, permissionHandler, logger);
  spawner.setFilesystemHandler(filesystemHandler);
  const sessionManager = new AcpSessionManager(sessionRepo, spawner, updateHandler, logger, modelPreferenceStore, collaborationConfig);
  const sessionSweeper = new AcpSessionSweeper(sessionManager, logger);
  const executor = new AcpExecutor(sessionManager, updateHandler, mcpConfigBuilder, agentConfig, logger);
  executor.setRoleRepository(roleRepo);
  executor.setAuditComponents(filesystemHandler, permissionHandler, auditRepository);
  executor.setSuspensionManager(suspensionManager);

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
    suspensionRepository: suspensionRepo,
    sessionRepository: sessionRepo,
    suspensionManager,
    sessionSweeper,
  };
}
