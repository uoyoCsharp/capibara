import 'reflect-metadata';
import { join } from 'node:path';
import { app } from 'electron';
import { loadConfig } from '@core/config/config.loader';
import { PinoLogger } from '@core/infrastructure/observability/pino-logger';
import { SqliteConnection } from '@core/infrastructure/persistence/sqlite/sqlite-connection';
import { runMigrations } from '@core/infrastructure/persistence/sqlite/migrations';
import { EmitteryEventBus } from '@core/infrastructure/observability/emittery-event-bus';
import { SqliteOutboxRepository } from '@core/infrastructure/persistence/sqlite/sqlite-outbox.repository';
import { OutboxEventPublisher } from '@core/infrastructure/observability/outbox.publisher';
import { registerExecutionModule } from './execution.module';
import { registerOrganizationModule } from './organization.module';
import { registerWorkflowModule } from './workflow.module';
import { registerConversationModule } from './conversation.module';
import { registerPromptModule } from './prompt.module';
import { registerMcpModule } from './mcp.module';
import { registerOrchestratorModule } from './orchestrator.module';
import { registerCoordinationModule } from './coordination.module';
import { registerPlanningModule } from './planning.module';
import { registerNotificationModule } from './notification.module';
import { registerOrganizationHandlers } from '@core/ipc-handlers/organization.handlers';
import { registerWorkflowHandlers } from '@core/ipc-handlers/workflow.handlers';
import { registerConversationHandlers } from '@core/ipc-handlers/conversation.handlers';
import { registerExecutionHandlers } from '@core/ipc-handlers/execution.handlers';
import { registerPlanTreeHandlers } from '@core/ipc-handlers/plan-tree.handlers';
import { registerSystemHandlers } from '@core/ipc-handlers/system.handlers';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { WorkerService } from '@core/modules/execution/workers/worker-service';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import type { RunOrchestrator } from '@core/modules/orchestrator/orchestrators/run.orchestrator';
import type { EventBroadcaster } from '@core/modules/notification/event-broadcaster';
import type { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';
import type { McpConfigGenerator } from '@core/modules/mcp/config/mcp-config-generator';

let logger: ILogger;
let sqliteConn: SqliteConnection;
let workerService: WorkerService;
let taskOrchestrator: TaskOrchestrator;
let conversationOrchestrator: ConversationOrchestrator;
let runOrchestrator: RunOrchestrator;
let eventBroadcaster: EventBroadcaster;
let mcpIpcServer: McpIpcServer;
let mcpConfigGen: McpConfigGenerator;

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  logger = new PinoLogger(config.logging.level);

  sqliteConn = new SqliteConnection(config.database.sqlitePath);
  runMigrations(sqliteConn.getDb(), { dbPath: config.database.sqlitePath });

  const eventBus = new EmitteryEventBus();
  const outboxRepo = new SqliteOutboxRepository(sqliteConn);
  const eventPublisher = new OutboxEventPublisher(outboxRepo, eventBus, logger);

  const resourcesDir = join(app.getAppPath(), 'resources');
  const workerPath = join(app.getAppPath(), 'out', 'main', 'capibara-worker.js');

  const org = registerOrganizationModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'templates'));
  const workflow = registerWorkflowModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'workflows'));
  const conversation = registerConversationModule(sqliteConn, eventPublisher, logger);
  workflow.taskService.setConversationRepository(conversation.conversationRepo);

  const coordination = registerCoordinationModule(
    eventBus,
    eventPublisher,
    logger,
    org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository,
    conversation.conversationRepo,
    conversation.conversationService,
  );

  const execution = registerExecutionModule(sqliteConn, eventBus, eventPublisher, logger, config, workerPath);

  const planning = registerPlanningModule(
    workflow.taskService,
    workflow.taskStateMachine, workflow.processEngine,
    sqliteConn,
    eventBus, eventPublisher, logger,
  );

  const mcp = registerMcpModule(
    logger, workflow.taskService, workflow.taskStateMachine, workflow.processEngine,
    conversation.conversationService, org.roleService, eventPublisher,
  );

  const mcpPort = await mcp.mcpIpcServer.start();
  const mcpConfigPath = mcp.mcpConfigGen.generate(mcpPort);
  execution.runEngine.setMcpConfigPath(mcpConfigPath);

  const prompt = registerPromptModule(
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository,
    org.skillService as unknown as import('@core/modules/organization/interfaces/i-skill.repository').ISkillRepository,
    conversation.conversationService as unknown as import('@core/modules/conversation/interfaces/i-conversation.repository').IConversationRepository,
    conversation.conversationContextBuilder,
    workflow.processEngine,
    org.orgRepo as unknown as import('@core/modules/organization/interfaces/i-organization.repository').IOrganizationRepository,
  );

  const orchestratorModule = registerOrchestratorModule(
    sqliteConn, eventBus, logger, config,
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository,
    org.orgRepo as unknown as import('@core/modules/organization/interfaces/i-organization.repository').IOrganizationRepository,
    execution.runRepo,
    execution.runEngine,
    conversation.conversationService as unknown as import('@core/modules/conversation/interfaces/i-conversation.repository').IConversationRepository,
    conversation.conversationService,
    prompt.promptBuilder,
    execution.costTracker,
    workflow.processEngine,
    workflow.taskStateMachine,
    workflow.behaviorEngine,
  );

  const notification = registerNotificationModule(eventBus, logger);

  registerOrganizationHandlers(org.organizationService, org.roleService, org.skillService, org.orgTemplateService, logger);
  registerWorkflowHandlers(workflow.taskService, workflow.taskStateMachine, workflow.processEngine, workflow.processTemplateService, planning.planningService);
  registerConversationHandlers(conversation.conversationService);
  registerExecutionHandlers(
    execution.runRepo,
    execution.runEngine,
    execution.costTracker,
    execution.fileLogService,
  );
  registerPlanTreeHandlers(planning.planningService);
  registerSystemHandlers(sqliteConn);

  workerService = execution.workerService;
  taskOrchestrator = orchestratorModule.taskOrchestrator;
  conversationOrchestrator = orchestratorModule.conversationOrchestrator;
  runOrchestrator = orchestratorModule.runOrchestrator;
  eventBroadcaster = notification.eventBroadcaster;
  mcpIpcServer = mcp.mcpIpcServer;
  mcpConfigGen = mcp.mcpConfigGen;

  planning.planningService.setWaker({
    tryWake: (roleId, orgId, reason, taskId) => taskOrchestrator.tryWake(roleId, orgId, reason, taskId),
  });
  prompt.runContext.setFeedbackProvider({
    consumePendingFeedback: (rootTaskId) => planning.planningService.consumePendingFeedback(rootTaskId),
  });

  org.skillSeeder.seedAll();
  org.orgTemplateService.loadTemplatesFromDisk();
  workflow.processTemplateService.loadTemplatesFromDisk();

  org.orgTemplateService.setProcessSchemaProvider({
    saveSchema: (orgId, schema) => workflow.processEngine.saveSchema(orgId, schema as Parameters<typeof workflow.processEngine.saveSchema>[1]),
    getDefaultSchema: () => {
      const defaultTpl = workflow.processTemplateService.getTemplates().find((t) => t.id === 'default');
      return defaultTpl?.schema ?? null;
    },
  });

  taskOrchestrator.start();
  conversationOrchestrator.start();
  runOrchestrator.start();
  eventBroadcaster.start();
  coordination.inquiryRouter.start();
  planning.planningService.init();
  eventPublisher.start();

  logger.info('Capibara core bootstrapped successfully');
}

export async function shutdown(): Promise<void> {
  logger?.info('Shutting down Capibara core...');
  mcpConfigGen?.cleanup();
  mcpIpcServer?.stop();
  sqliteConn?.close();
}

export function getEventBroadcaster(): EventBroadcaster {
  return eventBroadcaster;
}
