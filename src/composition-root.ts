/**
 * Composition Root - The only assembly entry point for the DI container
 * This is the only file in the project that can import from all layers
 * @module composition-root
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { join } from 'node:path';

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

// MVTT Implementation
import { registerMvtt } from './implementations/mvtt/index.js';

// Trigger (independent from MVTT)
import { GitHubIssuesTrigger } from './infrastructure/triggers/github-issues.trigger.js';

// Application
import { PipelineService } from './application/pipeline/pipeline.service.js';
import type { ICommandExecutor } from './core/interfaces/command-executor.interface.js';

/**
 * Initialize DI container and return PipelineService
 * @param configPath Optional config file path
 */
export function bootstrap(configPath?: string): PipelineService {
  // 1. Config
  const config = loadConfig(configPath);
  container.register(CONFIG_TOKEN, { useValue: config });

  // 2. Logger
  const logger = createLogger(config);
  container.register(LOGGER_TOKEN, { useValue: logger });

  // 3. Infrastructure
  container.registerSingleton(CLI_ADAPTER_TOKEN, ClaudeCliAdapter);
  container.registerSingleton(STATE_STORE_TOKEN, JsonStateStore);
  container.registerSingleton(ARTIFACT_STORE_TOKEN, FsArtifactStore);
  container.registerSingleton(EVENT_BUS_TOKEN, EmitteryEventBus);
  container.registerSingleton(COST_TRACKER_TOKEN, CostTracker);

  // 4. Command Executors (shared by all roles)
  const cliAdapter = container.resolve<ClaudeCliAdapter>(CLI_ADAPTER_TOKEN);
  const executorRegistry = new Map<string, ICommandExecutor>();
  executorRegistry.set('claude-cli', new ClaudeCliExecutor(cliAdapter, logger));
  executorRegistry.set('shell-command', new ShellExecutor(logger));

  const defaultExecutor = executorRegistry.get(config.executor?.defaultType ?? 'claude-cli')!;
  container.register(COMMAND_EXECUTOR_TOKEN, { useValue: defaultExecutor });

  // 5. MVTT Role Implementations (single call registers all roles, including prompt framework)
  registerMvtt(container);

  // 6. Pipeline Infrastructure
  const definitionLoader = new PipelineDefinitionLoader(logger);
  container.register(PIPELINE_DEFINITION_LOADER_TOKEN, { useValue: definitionLoader });

  // 7. Trigger (independent from MVTT)
  if (config.trigger.type === 'github_issues') {
    container.registerSingleton(TRIGGER_TOKEN, GitHubIssuesTrigger);
  }

  // 8. Application Service
  return container.resolve(PipelineService);
}
