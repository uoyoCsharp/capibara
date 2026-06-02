import 'reflect-metadata';
import { join } from 'node:path';
import { createRequire } from 'node:module';
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
import type { McpHttpTransportManager } from '@core/modules/mcp/mcp-http-transport';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';

let logger: ILogger;
let sqliteConn: SqliteConnection;
let acpModule: AcpModule;
let taskOrchestrator: TaskOrchestrator;
let conversationOrchestrator: ConversationOrchestrator;
let runOrchestrator: RunOrchestrator;
let eventBroadcaster: EventBroadcaster;
let mcpTransport: McpHttpTransportManager;

function normalizeDefaultAgentId(requested: string | null | undefined): string {
  if (!requested) return 'claude-agent';
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

  const _require = createRequire(import.meta.url);

  const resolvedAgentEntry = process.env.CLAUDE_AGENT_ACP_ENTRY
    ?? _require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');

  // claude-agent-acp auto-discovers Claude Code via its bundled
  // @anthropic-ai/claude-agent-sdk platform binary.  Only forward
  // CLAUDE_CODE_EXECUTABLE when the user explicitly sets it in the
  // system environment (e.g. to pin a specific agent binary version).
  const agentEnv: Record<string, string> = {};
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    agentEnv.CLAUDE_CODE_EXECUTABLE = process.env.CLAUDE_CODE_EXECUTABLE;
  }

  const registry = [
      {
        id: 'claude-agent',
        name: 'Claude Agent',
        command: 'node',
        args: [resolvedAgentEntry],
        env: agentEnv,
        mcpTransport: 'sse' as const,
      },
    ];

  const requestedDefaultAgent = normalizeDefaultAgentId(config.agents?.defaultAgent);
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
  acpModule = registerAcpModule(eventBus, logger, agentConfig, sqliteConn, org.roleRepo, config.collaboration);

  // ADR-7: agent subprocesses died with the previous app process, so every persisted non-terminal
  // session is stale. Mark them expired (rebuild lazily on next use); no eager reconnect.
  await acpModule.sessionManager.reconcileOnStartup();

  const workflow = registerWorkflowModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'workflows'), org.roleRepo);
  const conversation = registerConversationModule(sqliteConn, eventPublisher, logger);
  workflow.taskService.setConversationRepository(conversation.conversationRepo);

  const coordination = registerCoordinationModule(
    eventBus,
    eventPublisher,
    logger,
    org.roleRepo,
    conversation.conversationRepo,
    conversation.conversationService,
  );

  const execution = registerExecutionModule(
    sqliteConn, eventBus, eventPublisher, logger, config, acpModule.executor,
    workflow.taskRepo,
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
    workflow.taskRepo,
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
    org.roleService,
  );

  const mcp = registerMcpModule(
    logger, workflow.taskService, workflow.taskStateMachine, workflow.processEngine,
    conversation.conversationService, org.roleService, planning.planningService, eventPublisher,
    acpModule.suspensionManager, config.collaboration,
  );

  const mcpPort = await mcp.mcpTransport.start(mcp.mcpServer);
  acpModule.mcpConfigBuilder.setHttpPort(mcpPort);

  const prompt = registerPromptModule(
    workflow.taskRepo,
    org.roleRepo,
    org.skillRepo,
    conversation.conversationRepo,
    conversation.conversationContextBuilder,
    workflow.processEngine,
    org.orgRepo,
  );

  const notification = registerNotificationModule(eventBus, logger);

  const orchestratorModule = registerOrchestratorModule(
    sqliteConn, eventBus, logger, config,
    workflow.taskRepo,
    org.roleRepo,
    org.orgRepo,
    execution.runRepo,
    execution.runEngine,
    conversation.conversationRepo,
    conversation.conversationService,
    prompt.promptBuilder,
    execution.costTracker,
    workflow.processEngine,
    workflow.taskStateMachine,
    workflow.behaviorEngine,
    notification.notificationService,
    acpModule.suspensionManager,
    acpModule.sessionManager,
  );

  // Wire executor's conversation repo (acp module created before conversation module)
  acpModule.executor.setConversationRepository(
    conversation.conversationRepo,
  );

  registerOrganizationHandlers(org.organizationService, org.roleService, org.skillService, org.orgTemplateService, logger);
  registerWorkflowHandlers(workflow.taskService, workflow.taskStateMachine, workflow.processEngine, workflow.processTemplateService);
  registerConversationHandlers(conversation.conversationService);
  registerExecutionHandlers(
    execution.runRepo,
    execution.runEngine,
    execution.costTracker,
    orchestratorModule.taskOrchestrator,
    workflow.taskRepo,
    execution.fileLogService,
  );
  registerPlanTreeHandlers(planning.planningService);
  registerAcpHandlers(acpModule.auditRepository, acpModule.suspensionRepository, acpModule.sessionManager, agentConfig.defaultAgent, acpModule.spawner, acpModule.sessionRepository, logger);
  registerSystemHandlers({
    connection: sqliteConn,
    runRepo: execution.runRepo,
    runEngine: execution.runEngine,
    wakeGateValidator: orchestratorModule.wakeGateValidator,
    taskOrchestrator: orchestratorModule.taskOrchestrator,
    orgRepo: org.orgRepo,
    logger,
    agentConfig,
    collaborationConfig: config.collaboration,
    spawner: acpModule.spawner,
    sessionManager: acpModule.sessionManager,
    sessionRepo: acpModule.sessionRepository,
    mcpTransportManager: mcp.mcpTransport,
    mcpConfigBuilder: acpModule.mcpConfigBuilder,
    mcpServerDeps: {
      taskService: workflow.taskService,
      taskStateMachine: workflow.taskStateMachine,
      processEngine: workflow.processEngine,
      conversationService: conversation.conversationService,
      roleService: org.roleService,
      planningService: planning.planningService,
      eventPublisher,
      suspensionManager: acpModule.suspensionManager,
      collaborationConfig: config.collaboration,
    },
  });

  taskOrchestrator = orchestratorModule.taskOrchestrator;
  conversationOrchestrator = orchestratorModule.conversationOrchestrator;
  runOrchestrator = orchestratorModule.runOrchestrator;
  eventBroadcaster = notification.eventBroadcaster;
  mcpTransport = mcp.mcpTransport;

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
  acpModule.sessionSweeper.start();
  eventPublisher.start();

  logger.info('Capibara core bootstrapped successfully');
}

export async function shutdown(): Promise<void> {
  logger?.info('Shutting down Capibara core...');
  acpModule?.sessionSweeper.stop();
  await acpModule?.sessionManager.shutdown();
  mcpTransport?.stop();
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
  taskRepo: ITaskRepository,
  processEngine: IProcessEngine,
  taskStateMachine: ITaskStateMachine,
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
