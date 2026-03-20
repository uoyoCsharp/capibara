/**
 * MVTT Implementation Package - "My Virtual Tech Team" role implementations
 *
 * Registers all MVTT role implementations to DI container.
 * composition-root.ts only needs a single call to registerMvtt().
 *
 * Future implementations (e.g., implementations/custom-team/) just need
 * to provide a similar registerCustomTeam() function.
 * @module implementations/mvtt
 */

import { join } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

import { MvttWorker } from './mvtt-worker.js';
import { MvttEvaluator } from './mvtt-evaluator.js';
import { MvttConductor } from './mvtt-conductor.js';
import { MvttMessenger } from './mvtt-messenger.js';
import { MvttOutputParser } from './mvtt-output-parser.js';
import { MvttPromptFramework } from './mvtt-prompt-framework.js';
import {
  WORKER_TOKEN,
  EVALUATOR_TOKEN,
  CONDUCTOR_TOKEN,
  MESSENGER_TOKEN,
  COMMAND_EXECUTOR_TOKEN,
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
} from '../../tokens.js';

export function registerMvtt(container: DependencyContainer): void {
  const logger = container.resolve<Logger>(LOGGER_TOKEN);
  const config = container.resolve<AutomationConfig>(CONFIG_TOKEN);
  const executor = container.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN);
  const outputParser = new MvttOutputParser(logger);

  // Worker
  container.register(WORKER_TOKEN, {
    useFactory: (c) =>
      new MvttWorker(
        c.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN),
        c.resolve<AutomationConfig>(CONFIG_TOKEN),
        c.resolve<Logger>(LOGGER_TOKEN),
        c.resolve(EVENT_BUS_TOKEN),
      ),
  });

  // Evaluators (MVP: single evaluator, array for future extensibility)
  const evaluators = [new MvttEvaluator(executor, config, logger)];
  container.register(EVALUATOR_TOKEN, { useValue: evaluators });

  // Conductor
  container.register(CONDUCTOR_TOKEN, {
    useFactory: (c) =>
      new MvttConductor(
        c.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN),
        outputParser,
        c.resolve<AutomationConfig>(CONFIG_TOKEN),
        c.resolve<Logger>(LOGGER_TOKEN),
      ),
  });

  // Prompt Framework — internal to MVTT, not exposed as DI token
  const { promptFramework: pfConfig } = config;
  const frameworkDir = join(config.cli.projectDir, pfConfig.rootDir || '.ai-agents');
  const framework = new MvttPromptFramework(frameworkDir);

  // Messenger
  container.register(MESSENGER_TOKEN, {
    useFactory: (c) =>
      new MvttMessenger(
        c.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN),
        outputParser,
        framework,
        c.resolve<AutomationConfig>(CONFIG_TOKEN),
        c.resolve<Logger>(LOGGER_TOKEN),
      ),
  });
}

// Re-export for direct imports
export { MvttWorker } from './mvtt-worker.js';
export { MvttEvaluator } from './mvtt-evaluator.js';
export { MvttConductor } from './mvtt-conductor.js';
export { MvttMessenger } from './mvtt-messenger.js';
export { MvttOutputParser } from './mvtt-output-parser.js';
export { MvttPromptFramework } from './mvtt-prompt-framework.js';
