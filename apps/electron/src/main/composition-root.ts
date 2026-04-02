import 'reflect-metadata';
import { container } from 'tsyringe';

import { loadConfig } from './config/config.loader.js';
import type { CapibaraConfig } from './core/types/config.types.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  SQLITE_CONNECTION_TOKEN,
  EVENT_BUS_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  TASK_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  RUN_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
  NARRATIVE_REPO_TOKEN,
  PENDING_WAKE_REPO_TOKEN,
  PROMPT_BUILDER_TOKEN,
  EXECUTOR_TOKEN,
  DISCUSSION_SERVICE_TOKEN,
  EXECUTION_ENGINE_TOKEN,
  MCP_IPC_SERVER_TOKEN,
  EVENT_DIGESTER_TOKEN,
  ORG_ORCHESTRATOR_TOKEN,
  WORKER_SERVICE_TOKEN,
  SETTINGS_REPO_TOKEN,
} from './core/tokens.js';

import { SqliteConnection } from './infrastructure/persistence/sqlite/sqlite-connection.js';
import { runMigrations } from './infrastructure/persistence/sqlite/migrations.js';
import { SqliteOrganizationRepository } from './infrastructure/persistence/sqlite/sqlite-organization.repository.js';
import { SqliteRoleRepository } from './infrastructure/persistence/sqlite/sqlite-role.repository.js';
import { SqliteTaskRepository } from './infrastructure/persistence/sqlite/sqlite-task.repository.js';
import { SqliteDiscussionRepository } from './infrastructure/persistence/sqlite/sqlite-discussion.repository.js';
import { SqliteRunRepository } from './infrastructure/persistence/sqlite/sqlite-run.repository.js';
import { SqliteSkillRepository } from './infrastructure/persistence/sqlite/sqlite-skill.repository.js';
import { SqliteCostEntryRepository } from './infrastructure/persistence/sqlite/sqlite-cost-entry.repository.js';
import { SqliteNarrativeRepository } from './infrastructure/persistence/sqlite/sqlite-narrative.repository.js';
import { SqlitePendingWakeRepository } from './infrastructure/persistence/sqlite/sqlite-pending-wake.repository.js';
import { SqliteSettingsRepository } from './infrastructure/persistence/sqlite/sqlite-settings.repository.js';
import { EmitteryEventBus } from './infrastructure/observability/emittery-event-bus.js';
import { PinoLogger } from './infrastructure/observability/pino-logger.js';
import { UtilityProcessExecutor } from './infrastructure/executors/utility-process.executor.js';
import { WorkerService } from './infrastructure/executors/worker-service.js';
import { PromptBuilder } from './application/skills/prompt-builder.js';
import { SkillSeeder } from './application/skills/skill-seeder.js';
import { OrgTemplateService } from './application/templates/org-template.service.js';
import { TaskStateMachine } from './application/state-machine/task.state-machine.js';
import { TaskService } from './application/tasks/task.service.js';
import { DecompositionAdvisor } from './application/tasks/decomposition.advisor.js';
import { ConsensusDetector } from './application/consensus/consensus.detector.js';
import { DiscussionService } from './application/discussion/discussion.service.js';
import { ExecutionContext } from './application/context/execution.context.js';
import { OrgContext } from './application/context/org.context.js';
import { ExecutionEngine } from './application/execution/execution.engine.js';
import { OrgOrchestrator } from './application/orchestrator/org.orchestrator.js';
import { EventDigester } from './application/progress/event.digester.js';
import { NarrativeEngine } from './application/progress/narrative.engine.js';
import { NotificationService } from './application/notifications/notification.service.js';
import { EventBroadcaster } from './application/notifications/event-broadcaster.js';
import { FileLogService } from './infrastructure/logging/file-log.service.js';
import { McpConfigGenerator } from './infrastructure/mcp/mcp-config-generator.js';
import { McpToolRegistry } from './infrastructure/mcp/mcp-tool-registry.js';
import { McpToolHandlers } from './infrastructure/mcp/mcp-tool-handlers.js';
import { McpIpcServer } from './infrastructure/mcp/mcp-ipc-server.js';

import { registerOrganizationHandlers } from './ipc-handlers/organization.handlers.js';
import { registerSnapshotHandlers } from './ipc-handlers/snapshot.handlers.js';
import { registerRoleHandlers } from './ipc-handlers/role.handlers.js';
import { registerSkillHandlers } from './ipc-handlers/skill.handlers.js';
import { registerTemplateHandlers } from './ipc-handlers/template.handlers.js';
import { registerTaskHandlers } from './ipc-handlers/task.handlers.js';
import { registerDiscussionHandlers } from './ipc-handlers/discussion.handlers.js';
import { registerRunHandlers } from './ipc-handlers/run.handlers.js';
import { registerApprovalHandlers } from './ipc-handlers/approval.handlers.js';
import { registerNarrativeHandlers } from './ipc-handlers/narrative.handlers.js';
import { registerSettingsHandlers } from './ipc-handlers/settings.handlers.js';
import { detectLocaleFromOS } from '@shared/locale/index.js';

import type { IOrganizationRepository } from './core/interfaces/i-organization.repository.js';
import type { IRoleRepository } from './core/interfaces/i-role.repository.js';
import type { ITaskRepository } from './core/interfaces/i-task.repository.js';
import type { IDiscussionRepository } from './core/interfaces/i-discussion.repository.js';
import type { IRunRepository } from './core/interfaces/i-run.repository.js';
import type { ISkillRepository } from './core/interfaces/i-skill.repository.js';
import type { ICostEntryRepository } from './core/interfaces/i-cost-entry.repository.js';
import type { INarrativeRepository } from './core/interfaces/i-narrative.repository.js';
import type { IPendingWakeRepository } from './core/interfaces/i-pending-wake.repository.js';
import type { ISettingsRepository } from './core/interfaces/i-settings.repository.js';
import type { IEventBus } from './core/interfaces/i-event-bus.js';
import type { ILogger } from './core/interfaces/i-logger.js';
import type { IPromptBuilder } from './core/interfaces/i-prompt-builder.js';
import type { IExecutor } from './core/interfaces/i-executor.js';

export async function bootstrap(): Promise<void> {
  // ─── Config ──────────────────────────────────────────────
  const config = loadConfig();
  container.register<CapibaraConfig>(CONFIG_TOKEN, { useValue: config });

  // ─── Logger ──────────────────────────────────────────────
  const logger = new PinoLogger(config.logging.level);
  container.register<ILogger>(LOGGER_TOKEN, { useValue: logger });

  // ─── SQLite ──────────────────────────────────────────────
  const sqliteConn = new SqliteConnection(config.database.sqlitePath);
  container.register(SQLITE_CONNECTION_TOKEN, { useValue: sqliteConn });

  // Run migrations
  runMigrations(sqliteConn.getDb());
  logger.info('Database migrations applied', { path: config.database.sqlitePath });

  // ─── Event Bus ───────────────────────────────────────────
  const eventBus = new EmitteryEventBus();
  container.register<IEventBus>(EVENT_BUS_TOKEN, { useValue: eventBus });

  // ─── Repositories ────────────────────────────────────────
  const orgRepo = new SqliteOrganizationRepository(sqliteConn);
  container.register<IOrganizationRepository>(ORGANIZATION_REPO_TOKEN, { useValue: orgRepo });

  const roleRepo = new SqliteRoleRepository(sqliteConn);
  container.register<IRoleRepository>(ROLE_REPO_TOKEN, { useValue: roleRepo });

  const taskRepo = new SqliteTaskRepository(sqliteConn);
  container.register<ITaskRepository>(TASK_REPO_TOKEN, { useValue: taskRepo });

  const discussionRepo = new SqliteDiscussionRepository(sqliteConn);
  container.register<IDiscussionRepository>(DISCUSSION_REPO_TOKEN, { useValue: discussionRepo });

  const runRepo = new SqliteRunRepository(sqliteConn);
  container.register<IRunRepository>(RUN_REPO_TOKEN, { useValue: runRepo });

  const skillRepo = new SqliteSkillRepository(sqliteConn);
  container.register<ISkillRepository>(SKILL_REPO_TOKEN, { useValue: skillRepo });

  const costRepo = new SqliteCostEntryRepository(sqliteConn);
  container.register<ICostEntryRepository>(COST_ENTRY_REPO_TOKEN, { useValue: costRepo });

  const narrativeRepo = new SqliteNarrativeRepository(sqliteConn);
  container.register<INarrativeRepository>(NARRATIVE_REPO_TOKEN, { useValue: narrativeRepo });

  const pendingWakeRepo = new SqlitePendingWakeRepository(sqliteConn);
  container.register<IPendingWakeRepository>(PENDING_WAKE_REPO_TOKEN, { useValue: pendingWakeRepo });

  const settingsRepo = new SqliteSettingsRepository(sqliteConn);
  container.register<ISettingsRepository>(SETTINGS_REPO_TOKEN, { useValue: settingsRepo });

  // ─── Application Services ────────────────────────────────
  const promptBuilder = new PromptBuilder();
  container.register<IPromptBuilder>(PROMPT_BUILDER_TOKEN, { useValue: promptBuilder });

  const executor = new UtilityProcessExecutor(logger);
  container.register<IExecutor>(EXECUTOR_TOKEN, { useValue: executor });

  // Worker service — resolve path to built worker script
  // electron-vite builds worker.ts as 'capibara-worker.js' alongside index.js in out/main/
  const { join, dirname } = require('node:path') as typeof import('node:path');
  const workerPath = join(dirname(__dirname), 'main', 'capibara-worker.js');
  const workerService = new WorkerService(workerPath, logger);
  executor.setWorkerService(workerService);
  try {
    workerService.start();
  } catch (err) {
    logger.error('Worker service failed to start', { error: String(err) });
  }
  container.register<WorkerService>(WORKER_SERVICE_TOKEN, { useValue: workerService });

  const templateService = new OrgTemplateService(orgRepo, roleRepo, skillRepo, logger);

  const taskStateMachine = new TaskStateMachine(taskRepo, eventBus, logger);
  const taskService = new TaskService(taskRepo, roleRepo, eventBus, logger, taskStateMachine);
  const decompositionAdvisor = new DecompositionAdvisor(config, taskRepo, logger);

  const consensusDetector = new ConsensusDetector(discussionRepo, roleRepo, eventBus, logger);
  const discussionService = new DiscussionService(
    config, logger, eventBus, discussionRepo, taskRepo, roleRepo,
    consensusDetector, taskStateMachine,
  );
  try { discussionService.start(); } catch (err) {
    logger.error('Discussion service failed to start', { error: String(err) });
  }

  // ─── File Log Service ───────────────────────────────────
  const fileLogService = new FileLogService(config.logging.logDir);

  // ─── Execution Engine & MCP ──────────────────────────────
  const orgContext = new OrgContext(orgRepo, roleRepo, taskRepo, logger);
  const executionContext = new ExecutionContext(taskRepo, roleRepo, skillRepo, discussionRepo, orgContext);

  const mcpConfigGen = new McpConfigGenerator(logger);

  const mcpToolRegistry = new McpToolRegistry(logger);
  const mcpToolHandlers = new McpToolHandlers(taskRepo, roleRepo, discussionRepo, eventBus, logger, taskService);
  mcpToolHandlers.registerAll(mcpToolRegistry);

  const mcpIpcServer = new McpIpcServer(logger, mcpToolRegistry);
  container.register<McpIpcServer>(MCP_IPC_SERVER_TOKEN, { useValue: mcpIpcServer });

  const executionEngine = new ExecutionEngine(
    config, logger, eventBus, orgRepo, runRepo, roleRepo, taskRepo, costRepo,
    executor, promptBuilder, executionContext, mcpConfigGen, mcpIpcServer,
    fileLogService, taskStateMachine,
  );

  // Start MCP IPC server and configure the config generator with its port
  try {
    const serverPort = await mcpIpcServer.start();
    mcpConfigGen.setPort(serverPort);
  } catch (err) {
    logger.error('MCP IPC server failed to start', { error: String(err) });
  }

  // ─── Orchestrator (Epic 7) ─────────────────────────────────
  const orchestrator = new OrgOrchestrator(
    config, logger, eventBus, taskRepo, roleRepo, runRepo,
    pendingWakeRepo, costRepo,
  );
  orchestrator.setExecutionEngine(executionEngine);
  orchestrator.setTaskStateMachine(taskStateMachine);
  try { orchestrator.start(); } catch (err) {
    logger.error('Orchestrator failed to start', { error: String(err) });
  }
  container.register<OrgOrchestrator>(ORG_ORCHESTRATOR_TOKEN, { useValue: orchestrator });

  // ─── Narrative Engine (Epic 9) ────────────────────────────────
  const narrativeEngine = new NarrativeEngine(
    narrativeRepo, orgRepo, taskRepo, runRepo, costRepo, discussionRepo, eventBus, logger,
  );

  // ─── Notification Service (Epic 8) ───────────────────────────
  const notificationService = new NotificationService(eventBus, logger);
  try { notificationService.start(); } catch (err) {
    logger.error('Notification service failed to start', { error: String(err) });
  }

  // ─── Event Broadcaster (forwards domain events to renderer) ────
  const eventBroadcaster = new EventBroadcaster(eventBus, logger);
  try { eventBroadcaster.start(); } catch (err) {
    logger.error('Event broadcaster failed to start', { error: String(err) });
  }

  // ─── Event Digester (Epic 7) ──────────────────────────────
  const eventDigester = new EventDigester(eventBus, logger);
  eventDigester.start(
    [
      'task:status-changed', 'task:completed', 'run:succeeded', 'run:failed',
      'discussion:vote-added', 'discussion:message-added',
    ],
    (digests) => {
      // Emit aggregated digest per org scope for IPC batching to Renderer
      for (const digest of digests) {
        eventBus.emit({
          type: 'narrative:updated',
          timestamp: new Date().toISOString(),
          payload: {
            orgId: digest.orgId,
            eventCount: digest.events.length,
            summary: digest.summary,
          },
        });
      }
    },
    300, // 300ms window for IPC batching
  );
  // Notification-level aggregation (30s window for user notifications)
  eventDigester.onNotification((digests) => {
    for (const digest of digests) {
      logger.info('Notification digest', { orgId: digest.orgId, summary: digest.summary });
    }
  });

  container.register<EventDigester>(EVENT_DIGESTER_TOKEN, { useValue: eventDigester });

  // ─── Seed Skills ─────────────────────────────────────────
  const skillSeeder = new SkillSeeder(skillRepo, logger);
  try { await skillSeeder.seedAll(); } catch (err) {
    logger.error('Skill seeder failed', { error: String(err) });
  }

  // ─── IPC Handlers ────────────────────────────────────────
  registerSnapshotHandlers(orgRepo, logger);
  registerOrganizationHandlers(orgRepo, logger);
  registerRoleHandlers(roleRepo, logger);
  registerSkillHandlers(skillRepo, logger);
  registerTemplateHandlers(templateService, logger);
  registerTaskHandlers(taskService, logger);
  registerDiscussionHandlers(discussionService, logger);
  registerRunHandlers(runRepo, orgRepo, executionEngine, fileLogService, logger);
  registerApprovalHandlers(roleRepo, taskRepo, discussionRepo, orchestrator, logger);
  registerNarrativeHandlers(narrativeEngine, costRepo, orgRepo, logger);
  registerSettingsHandlers(settingsRepo, logger);

  // ─── OS Locale Detection (first launch) ─────────────────
  try {
    const existingLocale = await settingsRepo.get('locale');
    if (!existingLocale) {
      const { app } = require('electron') as typeof import('electron');
      const osLocale = app.getLocale();
      const detectedLocale = detectLocaleFromOS(osLocale);
      await settingsRepo.set('locale', detectedLocale);
      logger.info('Auto-detected locale from OS', { osLocale, detectedLocale });
    }
  } catch (err) {
    logger.error('Failed to detect OS locale', { error: String(err) });
  }

  logger.info('Capibara bootstrap complete');
}

export function shutdown(): void {
  try {
    const orchestrator = container.resolve<OrgOrchestrator>(ORG_ORCHESTRATOR_TOKEN);
    orchestrator.stop();
  } catch {
    // Orchestrator may not have been started
  }
  try {
    const digester = container.resolve<EventDigester>(EVENT_DIGESTER_TOKEN);
    digester.stop();
  } catch {
    // EventDigester may not have been started
  }
  try {
    const ws = container.resolve<WorkerService>(WORKER_SERVICE_TOKEN);
    ws.destroy();
  } catch {
    // WorkerService may not have been started
  }
  try {
    const mcpServer = container.resolve<McpIpcServer>(MCP_IPC_SERVER_TOKEN);
    mcpServer.stop();
  } catch {
    // MCP server may not have been started
  }
  const conn = container.resolve<SqliteConnection>(SQLITE_CONNECTION_TOKEN);
  conn.close();
}
