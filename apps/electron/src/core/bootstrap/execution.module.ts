import { container } from 'tsyringe';
import {
  RUN_ENGINE_TOKEN,
  EXECUTOR_TOKEN,
  RUN_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { CapibaraConfig } from '@core/config/config.types';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import { SqliteRunRepository } from '@core/modules/execution/persistence/sqlite-run.repository';
import { SqliteCostEntryRepository } from '@core/modules/execution/persistence/sqlite-cost-entry.repository';
import { CostTracker } from '@core/modules/execution/services/cost-tracker';
import { FileLogService } from '@core/modules/execution/logging/file-log.service';
import { RunEngine } from '@core/modules/execution/engines/run.engine';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { IExecutor } from '@core/modules/execution/interfaces/i-executor';

export interface ExecutionModule {
  runRepo: IRunRepository;
  runEngine: RunEngine;
  costTracker: CostTracker;
  fileLogService: FileLogService;
}

export function registerExecutionModule(
  connection: ISqliteConnection,
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  logger: ILogger,
  config: CapibaraConfig,
  executor: IExecutor,
  taskRepo: ITaskRepository,
  taskStateMachine: ITaskStateMachine,
  processEngine: IProcessEngine,
): ExecutionModule {
  const runRepo = new SqliteRunRepository(connection);
  const costEntryRepo = new SqliteCostEntryRepository(connection);
  const costTracker = new CostTracker(costEntryRepo);
  const fileLogService = new FileLogService(config.logging.logDir);
  const runEngine = new RunEngine(
    runRepo, executor, eventBus, eventPublisher, logger, costTracker, fileLogService,
    taskRepo, taskStateMachine, processEngine,
  );

  container.register(RUN_REPO_TOKEN, { useValue: runRepo });
  container.register(COST_ENTRY_REPO_TOKEN, { useValue: costEntryRepo });
  container.register(EXECUTOR_TOKEN, { useValue: executor });
  container.register(RUN_ENGINE_TOKEN, { useValue: runEngine });

  return { runRepo, runEngine, costTracker, fileLogService };
}
