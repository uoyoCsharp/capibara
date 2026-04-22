import { container } from 'tsyringe';
import {
  RUN_ENGINE_TOKEN,
  EXECUTOR_TOKEN,
  WORKER_SERVICE_TOKEN,
  RUN_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { CapibaraConfig } from '@core/config/config.types';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import { SqliteRunRepository } from '@core/modules/execution/persistence/sqlite-run.repository';
import { SqliteCostEntryRepository } from '@core/modules/execution/persistence/sqlite-cost-entry.repository';
import { WorkerService } from '@core/modules/execution/workers/worker-service';
import { UtilityProcessExecutor } from '@core/modules/execution/workers/utility-process.executor';
import { CostTracker } from '@core/modules/execution/services/cost-tracker';
import { FileLogService } from '@core/modules/execution/logging/file-log.service';
import { RunEngine } from '@core/modules/execution/engines/run.engine';

export interface ExecutionModule {
  runRepo: IRunRepository;
  runEngine: RunEngine;
  costTracker: CostTracker;
  workerService: WorkerService;
  fileLogService: FileLogService;
}

export function registerExecutionModule(
  connection: ISqliteConnection,
  eventBus: IEventBus,
  logger: ILogger,
  config: CapibaraConfig,
  workerPath: string,
): ExecutionModule {
  const runRepo = new SqliteRunRepository(connection);
  const costEntryRepo = new SqliteCostEntryRepository(connection);
  const costTracker = new CostTracker(costEntryRepo);
  const fileLogService = new FileLogService(config.logging.logDir);
  const workerService = new WorkerService(workerPath, logger);
  const executor = new UtilityProcessExecutor(workerService);
  const runEngine = new RunEngine(runRepo, executor, eventBus, logger, config, costTracker, fileLogService);

  container.register(RUN_REPO_TOKEN, { useValue: runRepo });
  container.register(COST_ENTRY_REPO_TOKEN, { useValue: costEntryRepo });
  container.register(WORKER_SERVICE_TOKEN, { useValue: workerService });
  container.register(EXECUTOR_TOKEN, { useValue: executor });
  container.register(RUN_ENGINE_TOKEN, { useValue: runEngine });

  return { runRepo, runEngine, costTracker, workerService, fileLogService };
}
