import { container } from 'tsyringe';
import {
  ORCHESTRATOR_TOKEN,
  RUN_COORDINATOR_TOKEN,
  PENDING_WAKE_REPO_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { CapibaraConfig } from '@core/config/config.types';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { IRunEngine } from '@core/modules/execution/interfaces/i-run-engine';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';
import { SqlitePendingWakeRepository } from '@core/modules/orchestrator/persistence/sqlite-pending-wake.repository';
import { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import { BudgetGuard } from '@core/modules/orchestrator/budget.guard';
import { RetryScheduler } from '@core/modules/orchestrator/retry.scheduler';
import { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import { Orchestrator } from '@core/modules/orchestrator/orchestrator';

export function registerOrchestratorModule(
  connection: ISqliteConnection,
  eventBus: IEventBus,
  logger: ILogger,
  config: CapibaraConfig,
  taskRepo: ITaskRepository,
  roleRepo: IRoleRepository,
  orgRepo: IOrganizationRepository,
  runRepo: IRunRepository,
  runEngine: IRunEngine,
  convRepo: IConversationRepository,
  conversationService: ConversationService,
  promptBuilder: PromptBuilder,
  costTracker: CostTracker,
): { orchestrator: Orchestrator; runCoordinator: RunCoordinator } {
  const pendingWakeRepo = new SqlitePendingWakeRepository(connection);
  const wakeGateValidator = new WakeGateValidator(roleRepo, runRepo, costTracker, config, logger);
  const budgetGuard = new BudgetGuard(costTracker, config);
  const retryScheduler = new RetryScheduler(runRepo, pendingWakeRepo, config, logger);
  const runCoordinator = new RunCoordinator(runEngine, promptBuilder, convRepo, conversationService, orgRepo, logger);
  const orchestrator = new Orchestrator(eventBus, logger, taskRepo, roleRepo, convRepo, pendingWakeRepo, wakeGateValidator, retryScheduler, runCoordinator);

  container.register(PENDING_WAKE_REPO_TOKEN, { useValue: pendingWakeRepo });
  container.register(RUN_COORDINATOR_TOKEN, { useValue: runCoordinator });
  container.register(ORCHESTRATOR_TOKEN, { useValue: orchestrator });

  return { orchestrator, runCoordinator };
}
