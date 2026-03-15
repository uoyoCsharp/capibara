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
  PROCESS_POOL_TOKEN,
  OUTPUT_PARSER_TOKEN,
  STATE_STORE_TOKEN,
  ARTIFACT_STORE_TOKEN,
  EVENT_BUS_TOKEN,
  PROMPT_FRAMEWORK_TOKEN,
  COST_TRACKER_TOKEN,
  WORKER_TOKEN,
  EVALUATOR_TOKEN,
  CONDUCTOR_TOKEN,
  MESSENGER_TOKEN,
  TRIGGER_TOKEN,
} from './tokens.js';

// Infrastructure
import { ClaudeCliAdapter } from './infrastructure/cli-adapter/claude-cli.adapter.js';
import { CliProcessPool } from './infrastructure/cli-adapter/process-pool.js';
import { CliOutputParser } from './infrastructure/cli-adapter/output-parser.js';
import { JsonStateStore } from './infrastructure/persistence/json-state-store.js';
import { FsArtifactStore } from './infrastructure/persistence/fs-artifact-store.js';
import { EmitteryEventBus } from './infrastructure/observability/emittery-event-bus.js';
import { AiAgentsFramework } from './infrastructure/prompt-framework/ai-agents-framework.js';
import { CostTracker } from './infrastructure/observability/cost-tracker.js';

// Roles
import { ClaudeCliWorker } from './roles/worker/claude-cli.worker.js';
import { QualityEvaluator } from './roles/evaluator/quality.evaluator.js';
import { SecurityEvaluator } from './roles/evaluator/security.evaluator.js';
import { ConsistencyEvaluator } from './roles/evaluator/consistency.evaluator.js';
import { RuleEngineConductor } from './roles/conductor/rule-engine.conductor.js';
import { ClaudeCliMessenger } from './roles/messenger/claude-cli.messenger.js';
import { GitHubIssuesTrigger } from './roles/trigger/github-issues.trigger.js';

// Application
import { PipelineService } from './application/pipeline/pipeline.service.js';
import type { IEvaluator } from './core/interfaces/evaluator.interface.js';
import type { IPromptFramework } from './core/interfaces/prompt-framework.interface.js';

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
  container.registerSingleton(OUTPUT_PARSER_TOKEN, CliOutputParser);

  // Process pool depends on already registered ClaudeCliAdapter
  container.register(PROCESS_POOL_TOKEN, {
    useFactory: (c) =>
      new CliProcessPool(c.resolve(CLI_ADAPTER_TOKEN), config.cli.maxConcurrentProcesses),
  });

  container.registerSingleton(STATE_STORE_TOKEN, JsonStateStore);
  container.registerSingleton(ARTIFACT_STORE_TOKEN, FsArtifactStore);
  container.registerSingleton(EVENT_BUS_TOKEN, EmitteryEventBus);
  container.registerSingleton(COST_TRACKER_TOKEN, CostTracker);

  // 4. Prompt Framework - Register based on config
  const framework = createPromptFramework(config);
  container.registerInstance(PROMPT_FRAMEWORK_TOKEN, framework);

  // 5. Roles
  container.registerSingleton(WORKER_TOKEN, ClaudeCliWorker);
  container.registerSingleton(CONDUCTOR_TOKEN, RuleEngineConductor);
  container.registerSingleton(MESSENGER_TOKEN, ClaudeCliMessenger);

  // Evaluator array registration: dynamically assembled based on configured dimensions
  const evaluatorMap: Record<string, new (...args: any[]) => IEvaluator> = {
    quality: QualityEvaluator,
    security: SecurityEvaluator,
    consistency: ConsistencyEvaluator,
  };
  const evaluators = config.evaluator.dimensions.map((dim) => {
    const Ctor = evaluatorMap[dim];
    if (!Ctor) {
      throw new Error(`Unknown evaluator dimension: ${dim}`);
    }
    return container.resolve(Ctor);
  });
  container.register(EVALUATOR_TOKEN, { useValue: evaluators });

  // Trigger: select based on configured type
  if (config.trigger.type === 'github_issues') {
    container.registerSingleton(TRIGGER_TOKEN, GitHubIssuesTrigger);
  }
  // manual mode does not register trigger

  // 6. Application Service
  return container.resolve(PipelineService);
}

/**
 * Create prompt framework instance based on config
 * Can be extended to support custom frameworks via dynamic import
 */
function createPromptFramework(config: ReturnType<typeof loadConfig>): IPromptFramework {
  const { promptFramework } = config;
  const projectDir = config.cli.projectDir;

  switch (promptFramework.type) {
    case 'ai-agents': {
      const rootDir = promptFramework.rootDir || '.ai-agents';
      return new AiAgentsFramework(join(projectDir, rootDir));
    }

    case 'custom': {
      // Future: support dynamic loading of custom framework
      // Currently not implemented, throw error
      throw new Error(
        `Custom prompt framework is not yet implemented. ` +
          `Please specify 'ai-agents' as the framework type.`,
      );
    }

    default:
      throw new Error(
        `Unknown prompt framework type: ${promptFramework.type}. ` +
          `Supported types: 'ai-agents'`,
      );
  }
}
