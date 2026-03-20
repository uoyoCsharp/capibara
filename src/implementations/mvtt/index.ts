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

import type { DependencyContainer } from 'tsyringe';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

import { MvttWorker } from './mvtt-worker.js';
import { MvttQualityEvaluator } from './mvtt-quality-evaluator.js';
import { MvttSecurityEvaluator } from './mvtt-security-evaluator.js';
import { MvttConsistencyEvaluator } from './mvtt-consistency-evaluator.js';
import { MvttConductor } from './mvtt-conductor.js';
import { MvttMessenger } from './mvtt-messenger.js';
import { MvttOutputParser } from './mvtt-output-parser.js';
import {
  WORKER_TOKEN,
  EVALUATOR_TOKEN,
  CONDUCTOR_TOKEN,
  MESSENGER_TOKEN,
  COMMAND_EXECUTOR_TOKEN,
  PROMPT_FRAMEWORK_TOKEN,
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
} from '../../tokens.js';

export function registerMvtt(container: DependencyContainer): void {
  const logger = container.resolve<Logger>(LOGGER_TOKEN);
  const outputParser = new MvttOutputParser(logger);

  // Worker
  container.register(WORKER_TOKEN, {
    useFactory: (c) => new MvttWorker(
      c.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN),
      c.resolve<AutomationConfig>(CONFIG_TOKEN),
      c.resolve<Logger>(LOGGER_TOKEN),
      c.resolve(EVENT_BUS_TOKEN),
    ),
  });

  // Evaluators
  const evaluatorMap: Record<string, new (
    executor: ICommandExecutor,
    parser: MvttOutputParser,
    config: AutomationConfig,
    logger: Logger,
  ) => IEvaluator> = {
    quality: MvttQualityEvaluator,
    security: MvttSecurityEvaluator,
    consistency: MvttConsistencyEvaluator,
  };

  const config = container.resolve<AutomationConfig>(CONFIG_TOKEN);
  const executor = container.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN);

  const evaluators = config.evaluator.dimensions.map((dim) => {
    const Ctor = evaluatorMap[dim];
    if (!Ctor) throw new Error(`Unknown evaluator dimension: ${dim}`);
    return new Ctor(executor, outputParser, config, logger);
  });
  container.register(EVALUATOR_TOKEN, { useValue: evaluators });

  // Conductor
  container.register(CONDUCTOR_TOKEN, {
    useFactory: (c) => new MvttConductor(
      c.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN),
      outputParser,
      c.resolve<AutomationConfig>(CONFIG_TOKEN),
      c.resolve<Logger>(LOGGER_TOKEN),
    ),
  });

  // Messenger
  container.register(MESSENGER_TOKEN, {
    useFactory: (c) => new MvttMessenger(
      c.resolve<ICommandExecutor>(COMMAND_EXECUTOR_TOKEN),
      outputParser,
      c.resolve(PROMPT_FRAMEWORK_TOKEN),
      c.resolve<AutomationConfig>(CONFIG_TOKEN),
      c.resolve<Logger>(LOGGER_TOKEN),
    ),
  });
}

// Re-export for direct imports
export { MvttWorker } from './mvtt-worker.js';
export { MvttEvaluator } from './mvtt-evaluator.js';
export { MvttQualityEvaluator } from './mvtt-quality-evaluator.js';
export { MvttSecurityEvaluator } from './mvtt-security-evaluator.js';
export { MvttConsistencyEvaluator } from './mvtt-consistency-evaluator.js';
export { MvttConductor } from './mvtt-conductor.js';
export { MvttMessenger } from './mvtt-messenger.js';
export { MvttOutputParser } from './mvtt-output-parser.js';
