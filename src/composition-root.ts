/**
 * Composition Root - The only assembly entry point for the DI container
 * This is the only file in the project that can import from all layers
 * @module composition-root
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { loadConfig } from './config/config.loader.js';
import { createLogger } from './infrastructure/observability/pino-logger.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  CLI_ADAPTER_TOKEN,
  COMMAND_EXECUTOR_TOKEN,
  STATE_STORE_TOKEN,
  ARTIFACT_STORE_TOKEN,
  EVENT_BUS_TOKEN,
  COST_TRACKER_TOKEN,
  PIPELINE_DEFINITION_LOADER_TOKEN,
  TRIGGER_TOKEN,
  SQLITE_STORE_TOKEN,
  REQUIREMENT_POOL_TOKEN,
  PROJECT_REGISTRY_TOKEN,
  EXECUTION_LOG_STORE_TOKEN,
  PROGRESS_QUERY_SERVICE_TOKEN,
  HUMAN_INTERACTION_HANDLER_TOKEN,
} from './tokens.js';

// Infrastructure
import { ClaudeCliAdapter } from './infrastructure/cli-adapter/claude-cli.adapter.js';
import { ClaudeCliExecutor } from './infrastructure/executors/claude-cli.executor.js';
import { ShellExecutor } from './infrastructure/executors/shell.executor.js';
import { JsonStateStore } from './infrastructure/persistence/json-state-store.js';
import { FsArtifactStore } from './infrastructure/persistence/fs-artifact-store.js';
import { EmitteryEventBus } from './infrastructure/observability/emittery-event-bus.js';
import { CostTracker } from './infrastructure/observability/cost-tracker.js';
import { PipelineDefinitionLoader } from './infrastructure/pipeline/pipeline-definition.loader.js';
import { SqliteStore } from './infrastructure/persistence/sqlite-store.js';
import { SqliteProjectRegistry } from './infrastructure/persistence/sqlite-project-registry.js';
import { SqliteRequirementPool } from './infrastructure/persistence/sqlite-requirement-pool.js';
import { JsonExecutionLogStore } from './infrastructure/persistence/json-execution-log-store.js';
import { ProgressQueryService } from './application/progress/progress-query.service.js';
import { HumanInteractionHandler } from './application/human-interaction/human-interaction.handler.js';
import { TerminalStrategy } from './application/human-interaction/strategies/terminal.strategy.js';

// MVTT Implementation
import { registerMvtt } from './implementations/mvtt/index.js';

// Trigger (independent from MVTT)
import { GitHubIssuesTrigger } from './infrastructure/triggers/github-issues.trigger.js';

// Application
import { PipelineService } from './application/pipeline/pipeline.service.js';
import type { ICommandExecutor } from './core/interfaces/command-executor.interface.js';
import type { AutomationConfig } from './core/types/config.types.js';
import type { IRequirementPool } from './core/interfaces/requirement-pool.interface.js';
import type { IProjectRegistry } from './core/interfaces/project-registry.interface.js';

/**
 * Light bootstrap - only SQLite, project registry, and requirement pool.
 * Used by pool/project CLI commands that don't need the full pipeline.
 */
export function bootstrapLight(configPath?: string): {
  config: AutomationConfig;
  sqliteStore: SqliteStore;
  projectRegistry: IProjectRegistry;
  requirementPool: IRequirementPool;
} {
  const config = loadConfig(configPath);
  const sqliteStore = SqliteStore.shared();
  const projectRegistry = new SqliteProjectRegistry(sqliteStore);
  const requirementPool = new SqliteRequirementPool(sqliteStore);

  return { config, sqliteStore, projectRegistry, requirementPool };
}

/**
 * Full bootstrap for pipeline execution.
 * Accepts an optional config override (used when loading project-specific config).
 */
export function bootstrap(configOrPath?: string | AutomationConfig): PipelineService {
  const config =
    typeof configOrPath === 'string' || configOrPath === undefined
      ? loadConfig(configOrPath)
      : configOrPath;

  // Use a child container to avoid polluting the global singleton registry
  const child = container.createChildContainer();

  // 1. Config
  child.register(CONFIG_TOKEN, { useValue: config });

  // 2. Logger
  const logger = createLogger(config);
  child.register(LOGGER_TOKEN, { useValue: logger });

  // 3. SQLite (shared singleton)
  const sqliteStore = SqliteStore.shared();
  child.register(SQLITE_STORE_TOKEN, { useValue: sqliteStore });
  child.register(REQUIREMENT_POOL_TOKEN, { useValue: new SqliteRequirementPool(sqliteStore) });
  child.register(PROJECT_REGISTRY_TOKEN, { useValue: new SqliteProjectRegistry(sqliteStore) });

  // 4. Infrastructure
  child.registerSingleton(CLI_ADAPTER_TOKEN, ClaudeCliAdapter);
  child.registerSingleton(STATE_STORE_TOKEN, JsonStateStore);
  child.registerSingleton(ARTIFACT_STORE_TOKEN, FsArtifactStore);
  child.registerSingleton(EVENT_BUS_TOKEN, EmitteryEventBus);
  child.registerSingleton(COST_TRACKER_TOKEN, CostTracker);
  child.registerSingleton(EXECUTION_LOG_STORE_TOKEN, JsonExecutionLogStore);

  // 4a. Application Services
  child.registerSingleton(PROGRESS_QUERY_SERVICE_TOKEN, ProgressQueryService);
  child.registerSingleton(HUMAN_INTERACTION_HANDLER_TOKEN, HumanInteractionHandler);

  // W3 fix: Initialize default TerminalStrategy for human interaction
  const humanHandler = child.resolve<HumanInteractionHandler>(HUMAN_INTERACTION_HANDLER_TOKEN);
  humanHandler.initializeWithDefaultStrategy(new TerminalStrategy());

  // 5. Command Executors (shared by all roles)
  const cliAdapter = child.resolve<ClaudeCliAdapter>(CLI_ADAPTER_TOKEN);
  const executorRegistry = new Map<string, ICommandExecutor>();
  executorRegistry.set('claude-cli', new ClaudeCliExecutor(cliAdapter, logger));
  executorRegistry.set('shell-command', new ShellExecutor(logger));

  const defaultExecutor = executorRegistry.get(config.executor?.defaultType ?? 'claude-cli')!;
  child.register(COMMAND_EXECUTOR_TOKEN, { useValue: defaultExecutor });

  // 6. MVTT Role Implementations (single call registers all roles, including prompt framework)
  registerMvtt(child);

  // 7. Pipeline Infrastructure
  const definitionLoader = new PipelineDefinitionLoader(logger);
  child.register(PIPELINE_DEFINITION_LOADER_TOKEN, { useValue: definitionLoader });

  // 8. Trigger (independent from MVTT)
  if (config.trigger.type === 'github_issues') {
    child.registerSingleton(TRIGGER_TOKEN, GitHubIssuesTrigger);
  }

  // 9. Application Service
  return child.resolve(PipelineService);
}

/**
 * Create a factory function that produces PipelineService from a given config.
 * Used by RequirementOrchestrator to re-bootstrap on project switch.
 */
export function createPipelineFactory(): (config: AutomationConfig) => PipelineService {
  return (config: AutomationConfig) => bootstrap(config);
}
