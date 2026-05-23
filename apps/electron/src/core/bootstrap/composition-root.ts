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
import { registerAcpModule, type AcpModule } from './acp.module';
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
import { registerAcpHandlers } from '@core/ipc-handlers/acp.handlers';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import type { RunOrchestrator } from '@core/modules/orchestrator/orchestrators/run.orchestrator';
import type { EventBroadcaster } from '@core/modules/notification/event-broadcaster';
import type { McpIpcServer } from '@core/modules/mcp/server/mcp-ipc.server';

let logger: ILogger;
let sqliteConn: SqliteConnection;
let acpModule: AcpModule;
let taskOrchestrator: TaskOrchestrator;
let conversationOrchestrator: ConversationOrchestrator;
let runOrchestrator: RunOrchestrator;
let eventBroadcaster: EventBroadcaster;
let mcpIpcServer: McpIpcServer;

function normalizeDefaultAgentId(requested: string | null | undefined): string {
  // Backward compatibility for legacy executor IDs kept in persisted config.
  if (!requested) return 'claude-agent';
  if (requested === 'claude-cli') return 'claude-agent';
  return requested;
}

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  logger = new PinoLogger(config.logging.level);

  sqliteConn = new SqliteConnection(config.database.sqlitePath);
  runMigrations(sqliteConn.getDb(), { dbPath: config.database.sqlitePath });

  const eventBus = new EmitteryEventBus();
  const outboxRepo = new SqliteOutboxRepository(sqliteConn);
  const eventPublisher = new OutboxEventPublisher(outboxRepo, eventBus, logger);

  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'resources');

  const registry = [
      {
        id: 'claude-agent',
        name: 'Claude Agent',
        command: 'node',
        args: [
          process.env.CLAUDE_AGENT_ACP_ENTRY
            ?? 'C:/nvm4w/nodejs/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
        ],
        env: {
          CLAUDE_CODE_EXECUTABLE: process.env.CLAUDE_CODE_EXECUTABLE
            ?? 'C:/nvm4w/nodejs/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
        },
      },
    ];

  const requestedDefaultAgent = normalizeDefaultAgentId(config.cli?.defaultExecutor);
  const hasRequestedDefault = registry.some((entry) => entry.id === requestedDefaultAgent);
  const resolvedDefaultAgent = hasRequestedDefault ? requestedDefaultAgent : registry[0]!.id;

  if (!hasRequestedDefault) {
    logger.warn('Configured default agent is not registered; falling back to first registry entry', {
      requestedDefaultAgent,
      fallbackAgent: resolvedDefaultAgent,
    });
  }

  const agentConfig = {
    defaultAgent: resolvedDefaultAgent,
    registry,
    globalFilePolicy: {
      denyPatterns: ['**/.env', '**/.env.*', '**/secrets/**', '**/.git/objects/**'],
    },
  };

  const org = registerOrganizationModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'templates'));
  acpModule = registerAcpModule(eventBus, logger, agentConfig, sqliteConn, org.roleRepo as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository, config.collaboration);

  const workflow = registerWorkflowModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'workflows'), org.roleRepo);
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

  const execution = registerExecutionModule(
    sqliteConn, eventBus, eventPublisher, logger, config, acpModule.executor,
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    workflow.taskStateMachine,
    workflow.processEngine,
  );

  const orphanedCount = execution.runRepo.markOrphanedAsInterrupted();
  if (orphanedCount > 0) {
    logger.info('Marked orphaned runs as interrupted on startup', { count: orphanedCount });
  }

  // R4 — After sweeping ghost runs, any task still in an 'active' status has
  // by definition no active run any more (the only thing that could keep a
  // task active is its own running run; we just nuked those). Roll them back
  // to the schema's first initial status so the scheduler can pick them up
  // again on demand. This is the cross-restart counterpart of rollbackTaskIfActive.
  reconcileOrphanedActiveTasks(
    org.organizationService.findAll().map((o) => o.id),
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    workflow.processEngine,
    workflow.taskStateMachine,
    logger,
  );

  const planning = registerPlanningModule(
    workflow.taskService,
    workflow.taskStateMachine, workflow.processEngine,
    sqliteConn,
    eventBus, eventPublisher, logger,
    conversation.conversationService,
  );

  const mcp = registerMcpModule(
    logger, workflow.taskService, workflow.taskStateMachine, workflow.processEngine,
    conversation.conversationService, org.roleService, eventPublisher,
    acpModule.suspensionManager, config.collaboration,
  );

  const mcpPort = await mcp.mcpIpcServer.start();
  acpModule.mcpConfigBuilder.setIpcPort(mcpPort);

  const prompt = registerPromptModule(
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    org.roleService as unknown as import('@core/modules/organization/interfaces/i-role.repository').IRoleRepository,
    org.skillService as unknown as import('@core/modules/organization/interfaces/i-skill.repository').ISkillRepository,
    conversation.conversationService as unknown as import('@core/modules/conversation/interfaces/i-conversation.repository').IConversationRepository,
    conversation.conversationContextBuilder,
    workflow.processEngine,
    org.orgRepo as unknown as import('@core/modules/organization/interfaces/i-organization.repository').IOrganizationRepository,
  );

  const notification = registerNotificationModule(eventBus, logger);

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
    notification.notificationService,
    acpModule.suspensionManager,
  );

  // Wire executor's conversation repo (acp module created before conversation module)
  acpModule.executor.setConversationRepository(
    conversation.conversationRepo as unknown as import('@core/modules/conversation/interfaces/i-conversation.repository').IConversationRepository,
  );

  registerOrganizationHandlers(org.organizationService, org.roleService, org.skillService, org.orgTemplateService, logger);
  registerWorkflowHandlers(workflow.taskService, workflow.taskStateMachine, workflow.processEngine, workflow.processTemplateService);
  registerConversationHandlers(conversation.conversationService);
  registerExecutionHandlers(
    execution.runRepo,
    execution.runEngine,
    execution.costTracker,
    orchestratorModule.taskOrchestrator,
    workflow.taskService as unknown as import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
    execution.fileLogService,
  );
  registerPlanTreeHandlers(planning.planningService);
  registerAcpHandlers(acpModule.auditRepository, acpModule.suspensionRepository);
  registerSystemHandlers({
    connection: sqliteConn,
    runRepo: execution.runRepo,
    runEngine: execution.runEngine,
    wakeGateValidator: orchestratorModule.wakeGateValidator,
    taskOrchestrator: orchestratorModule.taskOrchestrator,
    orgRepo: org.orgRepo as unknown as import('@core/modules/organization/interfaces/i-organization.repository').IOrganizationRepository,
    logger,
    agentConfig,
    collaborationConfig: config.collaboration,
  });

  taskOrchestrator = orchestratorModule.taskOrchestrator;
  conversationOrchestrator = orchestratorModule.conversationOrchestrator;
  runOrchestrator = orchestratorModule.runOrchestrator;
  eventBroadcaster = notification.eventBroadcaster;
  mcpIpcServer = mcp.mcpIpcServer;

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
    getSchemaById: (id) => workflow.processTemplateService.getTemplate(id)?.schema ?? null,
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
  await acpModule?.sessionManager.shutdown();
  mcpIpcServer?.stop();
  sqliteConn?.close();
}

export function getEventBroadcaster(): EventBroadcaster {
  return eventBroadcaster;
}

export function getSqliteConnection(): SqliteConnection {
  return sqliteConn;
}

function reconcileOrphanedActiveTasks(
  orgIds: string[],
  taskRepo: import('@core/modules/workflow/interfaces/i-task.repository').ITaskRepository,
  processEngine: import('@core/modules/workflow/engines/process.engine').ProcessEngine,
  taskStateMachine: import('@core/modules/workflow/engines/task.state-machine').TaskStateMachine,
  log: ILogger,
): void {
  let total = 0;
  for (const orgId of orgIds) {
    const initial = processEngine.getInitialStatus(orgId);
    if (!initial) continue;

    for (const task of taskRepo.findByOrgId(orgId)) {
      if (processEngine.getStatusCategory(orgId, task.status) !== 'active') continue;
      try {
        taskStateMachine.transition(task.id, initial.name, { triggeredBy: 'system' });
        total += 1;
      } catch (err) {
        log.error('Failed to reconcile orphaned active task on startup', {
          taskId: task.id, from: task.status, to: initial.name, error: String(err),
        });
      }
    }
  }
  if (total > 0) {
    log.info('Reconciled orphaned active tasks on startup', { count: total });
  }
}
