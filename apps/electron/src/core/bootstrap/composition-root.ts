import 'reflect-metadata';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import { loadConfig } from '@core/config/config.loader';
import type { CapibaraConfig } from '@core/config/config.types';
import { PinoLogger } from '@core/infrastructure/observability/pino-logger';
import { SqliteConnection } from '@core/infrastructure/persistence/sqlite/sqlite-connection';
import { runMigrations } from '@core/infrastructure/persistence/sqlite/migrations';
import { EmitteryEventBus } from '@core/infrastructure/observability/emittery-event-bus';
import { SqliteOutboxRepository } from '@core/infrastructure/persistence/sqlite/sqlite-outbox.repository';
import { OutboxEventPublisher } from '@core/infrastructure/observability/outbox.publisher';
import { registerExecutionModule, type ExecutionModule } from './execution.module';
import { registerAcpModule, type AcpModule } from './acp.module';
import { registerOrganizationModule, type OrganizationModule } from './organization.module';
import { registerWorkflowModule, type WorkflowModule } from './workflow.module';
import { registerConversationModule, type ConversationModule } from './conversation.module';
import { registerPromptModule, type PromptModule } from './prompt.module';
import { registerMcpModule, type McpModule } from './mcp.module';
import { registerOrchestratorModule, type OrchestratorModule } from './orchestrator.module';
import { registerCoordinationModule, type CoordinationModule } from './coordination.module';
import { registerPlanningModule, type PlanningModule } from './planning.module';
import { registerNotificationModule } from './notification.module';
import { registerOrganizationHandlers } from '@core/ipc-handlers/organization.handlers';
import { registerWorkflowHandlers } from '@core/ipc-handlers/workflow.handlers';
import { registerConversationHandlers } from '@core/ipc-handlers/conversation.handlers';
import { registerExecutionHandlers } from '@core/ipc-handlers/execution.handlers';
import { registerPlanTreeHandlers } from '@core/ipc-handlers/plan-tree.handlers';
import { registerSystemHandlers } from '@core/ipc-handlers/system.handlers';
import { registerAcpHandlers } from '@core/ipc-handlers/acp.handlers';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { AgentRegistryEntry } from '@core/modules/acp/types/acp.types';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import type { RunOrchestrator } from '@core/modules/orchestrator/orchestrators/run.orchestrator';
import type { EventBroadcaster } from '@core/infrastructure/notification/event-broadcaster';
import type { McpHttpTransportManager } from '@core/infrastructure/mcp-protocol/mcp-http-transport';

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

const execAsync = promisify(exec);

async function resolveOpenCodeExecutable(log: ILogger): Promise<string | null> {
  if (process.env.OPENCODE_EXECUTABLE) {
    return process.env.OPENCODE_EXECUTABLE;
  }
  try {
    const cmd = process.platform === 'win32' ? 'where opencode' : 'which opencode';
    const { stdout } = await execAsync(cmd, { timeout: 3000 });
    const candidates = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (candidates.length === 0) return null;
    if (process.platform === 'win32') {
      const native = candidates.find(c => /\.(cmd|exe|bat)$/i.test(c));
      if (native) return native;
    }
    return candidates[0] ?? null;
  } catch {
    log.warn('OpenCode executable not found on PATH; opencode-agent will not be available', {
      hint: 'Set OPENCODE_EXECUTABLE env var or install opencode (https://opencode.ai)',
    });
    return null;
  }
}

interface AgentConfig {
  defaultAgent: string;
  registry: AgentRegistryEntry[];
  globalFilePolicy: {
    denyPatterns: string[];
  };
}

async function buildAgentConfig(
  config: CapibaraConfig,
  log: ILogger,
  conn: SqliteConnection,
): Promise<AgentConfig> {
  const _require = createRequire(import.meta.url);

  const resolvedAgentEntry = process.env.CLAUDE_AGENT_ACP_ENTRY
    ?? _require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');

  const agentEnv: Record<string, string> = {};
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    agentEnv.CLAUDE_CODE_EXECUTABLE = process.env.CLAUDE_CODE_EXECUTABLE;
  }

  const registry: AgentRegistryEntry[] = [
    {
      id: 'claude-agent',
      name: 'Claude Agent',
      command: 'node',
      args: [resolvedAgentEntry],
      env: agentEnv,
      mcpTransport: 'http' as const,
    },
  ];

  const openCodePath = await resolveOpenCodeExecutable(log);
  if (openCodePath) {
    registry.push({
      id: 'opencode-agent',
      name: 'OpenCode',
      command: openCodePath,
      args: ['acp'],
      mcpTransport: 'http' as const,
    });
  }

  const persistedDefaultAgent = (() => {
    try {
      const row = conn.getDb()
        .prepare("SELECT value FROM settings WHERE key = 'default_agent'")
        .get() as { value: string } | undefined;
      return row?.value ?? null;
    } catch { return null; }
  })();

  const requestedDefaultAgent = normalizeDefaultAgentId(
    persistedDefaultAgent ?? config.agents?.defaultAgent,
  );
  const hasRequestedDefault = registry.some((entry) => entry.id === requestedDefaultAgent);
  const resolvedDefaultAgent = hasRequestedDefault ? requestedDefaultAgent : registry[0]!.id;

  if (!hasRequestedDefault) {
    log.warn('Configured default agent is not registered; falling back to first registry entry', {
      requestedDefaultAgent,
      fallbackAgent: resolvedDefaultAgent,
    });
  }

  return {
    defaultAgent: resolvedDefaultAgent,
    registry,
    globalFilePolicy: {
      denyPatterns: ['**/.env', '**/.env.*', '**/secrets/**', '**/.git/objects/**'],
    },
  };
}

function registerAllIpcHandlers(
  org: OrganizationModule,
  workflow: WorkflowModule,
  conversation: ConversationModule,
  execution: ExecutionModule,
  planning: PlanningModule,
  orchestratorMod: OrchestratorModule,
  agentConfig: AgentConfig,
  config: CapibaraConfig,
  mcp: McpModule,
  eventPublisher: IEventPublisher,
  eventBus: IEventBus,
): void {
  registerOrganizationHandlers(org.organizationService, org.roleService, org.skillService, org.orgTemplateService, logger);
  registerWorkflowHandlers(workflow.taskService, workflow.taskStateMachine, workflow.processEngine, workflow.processTemplateService, workflow.taskDependencyService);
  registerConversationHandlers(conversation.conversationService);
  registerExecutionHandlers(
    execution.runRepo,
    execution.runEngine,
    execution.costTracker,
    orchestratorMod.taskOrchestrator,
    workflow.taskRepo,
    execution.fileLogService,
  );
  registerPlanTreeHandlers(planning.planningService);
  registerAcpHandlers(acpModule.auditRepository, acpModule.suspensionRepository, acpModule.sessionManager, agentConfig, acpModule.spawner, acpModule.sessionRepository, logger, execution.runRepo, eventBus);
  registerSystemHandlers({
    connection: sqliteConn,
    runRepo: execution.runRepo,
    runEngine: execution.runEngine,
    wakeGateValidator: orchestratorMod.wakeGateValidator,
    taskOrchestrator: orchestratorMod.taskOrchestrator,
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
}

function wirePostBootstrap(
  org: OrganizationModule,
  workflow: WorkflowModule,
  conversation: ConversationModule,
  planning: PlanningModule,
  prompt: PromptModule,
): void {
  acpModule.executor.setConversationRepository(conversation.conversationRepo);

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
}

function startAllServices(coordination: CoordinationModule, planning: PlanningModule): void {
  taskOrchestrator.start();
  conversationOrchestrator.start();
  runOrchestrator.start();
  eventBroadcaster.start();
  coordination.inquiryOrchestrator.start();
  planning.planningService.init();
  acpModule.sessionSweeper.start();
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

  const agentConfig = await buildAgentConfig(config, logger, sqliteConn);

  const org = registerOrganizationModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'templates'));
  acpModule = registerAcpModule(eventBus, logger, agentConfig, sqliteConn, org.roleRepo, config.collaboration);

  await acpModule.sessionManager.reconcileOnStartup();

  const workflow = registerWorkflowModule(sqliteConn, eventPublisher, logger, join(resourcesDir, 'workflows'), org.roleRepo);
  const conversation = registerConversationModule(sqliteConn, eventBus, eventPublisher, logger);

  const coordination = registerCoordinationModule(
    eventBus,
    eventPublisher,
    logger,
    org.roleRepo,
    conversation.conversationRepo,
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

  workflow.taskStateMachine.reconcileOrphanedActiveTasks(
    org.organizationService.findAll().map((o) => o.id),
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

  const mcpPort = await mcp.mcpTransport.start(mcp.serverFactory);
  acpModule.mcpConfigBuilder.setHttpPort(mcpPort);
  acpModule.sessionManager.setMcpTransportPool(mcp.mcpTransport);

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

  const orchestratorMod = registerOrchestratorModule(
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

  taskOrchestrator = orchestratorMod.taskOrchestrator;
  conversationOrchestrator = orchestratorMod.conversationOrchestrator;
  runOrchestrator = orchestratorMod.runOrchestrator;
  eventBroadcaster = notification.eventBroadcaster;
  mcpTransport = mcp.mcpTransport;

  registerAllIpcHandlers(org, workflow, conversation, execution, planning, orchestratorMod, agentConfig, config, mcp, eventPublisher, eventBus);
  wirePostBootstrap(org, workflow, conversation, planning, prompt);
  startAllServices(coordination, planning);
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
