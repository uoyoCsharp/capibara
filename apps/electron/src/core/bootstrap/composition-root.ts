import 'reflect-metadata';
import { join } from 'node:path';
import { app } from 'electron';
import { loadConfig } from '@core/config/config.loader';
import { PinoLogger } from '@core/infrastructure/observability/pino-logger';
import { SqliteConnection } from '@core/infrastructure/persistence/sqlite/sqlite-connection';
import { runMigrations } from '@core/infrastructure/persistence/sqlite/migrations';
import { EmitteryEventBus } from '@core/infrastructure/observability/emittery-event-bus';
import { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';
import { registerExecutionModule } from './execution.module';
import { registerOrganizationModule } from './organization.module';
import { registerWorkflowModule } from './workflow.module';
import { registerConversationModule } from './conversation.module';
import { registerPromptModule } from './prompt.module';
import { registerMcpModule } from './mcp.module';
import { registerOrchestratorModule } from './orchestrator.module';
import { registerPlanningModule } from './planning.module';
import { registerNotificationModule } from './notification.module';
import { registerOrganizationHandlers } from '@core/ipc-handlers/organization.handlers';
import { registerWorkflowHandlers } from '@core/ipc-handlers/workflow.handlers';
import { registerConversationHandlers } from '@core/ipc-handlers/conversation.handlers';
import { registerExecutionHandlers } from '@core/ipc-handlers/execution.handlers';
import { registerPlanningHandlers } from '@core/ipc-handlers/planning.handlers';
import { registerSystemHandlers } from '@core/ipc-handlers/system.handlers';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { WorkerService } from '@core/modules/execution/workers/worker-service';
import type { Orchestrator } from '@core/modules/orchestrator/orchestrator';
import type { EventBroadcaster } from '@core/modules/notification/event-broadcaster';

let logger: ILogger;
let sqliteConn: SqliteConnection;
let workerService: WorkerService;
let orchestrator: Orchestrator;
let eventBroadcaster: EventBroadcaster;

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  logger = new PinoLogger(config.logging.level);

  sqliteConn = new SqliteConnection(config.database.sqlitePath);
  runMigrations(sqliteConn.getDb());

  const eventBus = new EmitteryEventBus();
  const pendingPlanStore = new PendingPlanStore();

  const resourcesDir = join(app.getAppPath(), 'resources');
  const workerPath = join(app.getAppPath(), 'out', 'main', 'capibara-worker.js');

  const execution = registerExecutionModule(sqliteConn, eventBus, logger, config, workerPath);

  const org = registerOrganizationModule(sqliteConn, eventBus, logger, join(resourcesDir, 'templates'));
  const workflow = registerWorkflowModule(sqliteConn, eventBus, logger, join(resourcesDir, 'workflows'));
  const conversation = registerConversationModule(sqliteConn, eventBus, logger, org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository);

  const prompt = registerPromptModule(
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository,
    org.skillService as unknown as import('@core/modules/organization/interfaces/i-skill.repository').ISkillRepository,
    conversation.conversationService as unknown as import('@core/modules/conversation/interfaces/i-conversation.repository').IConversationRepository,
    conversation.conversationContextBuilder,
  );

  const mcp = registerMcpModule(
    logger, workflow.taskService, workflow.taskStateMachine, workflow.processEngine,
    conversation.conversationService, org.roleService, pendingPlanStore,
  );

  const orchestratorModule = registerOrchestratorModule(
    sqliteConn, eventBus, logger, config,
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository,
    execution.runRepo,
    execution.runEngine,
    conversation.conversationService as unknown as import('@core/modules/conversation/interfaces/i-conversation.repository').IConversationRepository,
    conversation.conversationService,
    prompt.promptBuilder,
    execution.costTracker,
  );

  const planning = registerPlanningModule(
    conversation.conversationService, workflow.taskService, pendingPlanStore, eventBus, logger,
  );

  const notification = registerNotificationModule(eventBus, logger);

  registerOrganizationHandlers(org.organizationService, org.roleService, org.skillService, org.orgTemplateService, logger);
  registerWorkflowHandlers(workflow.taskService, workflow.taskStateMachine, workflow.processEngine, workflow.processTemplateService);
  registerConversationHandlers(conversation.conversationService);
  registerExecutionHandlers(
    execution.runRepo,
    execution.runEngine,
    execution.costTracker,
  );
  registerPlanningHandlers(planning.planningService);
  registerSystemHandlers(sqliteConn);

  workerService = execution.workerService;
  orchestrator = orchestratorModule.orchestrator;
  eventBroadcaster = notification.eventBroadcaster;

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

  orchestrator.start();
  eventBroadcaster.start();

  logger.info('Capibara core bootstrapped successfully');
}

export async function shutdown(): Promise<void> {
  logger?.info('Shutting down Capibara core...');
  sqliteConn?.close();
}

export function getEventBroadcaster(): EventBroadcaster {
  return eventBroadcaster;
}
