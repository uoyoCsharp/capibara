import { container } from 'tsyringe';
import {
  TASK_ORCHESTRATOR_TOKEN,
  CONVERSATION_ORCHESTRATOR_TOKEN,
  RUN_ORCHESTRATOR_TOKEN,
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
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';
import type { IBehaviorEngine } from '@core/modules/workflow/interfaces/i-behavior.engine';
import type { NotificationService } from '@core/modules/notification/notification.service';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import { SqlitePendingWakeRepository } from '@core/modules/orchestrator/persistence/sqlite-pending-wake.repository';
import { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import { RetryScheduler } from '@core/modules/orchestrator/retry.scheduler';
import { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import { TaskScheduler } from '@core/modules/orchestrator/task.scheduler';
import { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import { ConversationOrchestrator } from '@core/modules/orchestrator/orchestrators/conversation.orchestrator';
import { RunOrchestrator } from '@core/modules/orchestrator/orchestrators/run.orchestrator';

export interface OrchestratorModule {
  taskOrchestrator: TaskOrchestrator;
  conversationOrchestrator: ConversationOrchestrator;
  runOrchestrator: RunOrchestrator;
  runCoordinator: RunCoordinator;
  wakeGateValidator: WakeGateValidator;
}

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
  conversationService: IConversationCommandService,
  promptBuilder: PromptBuilder,
  costTracker: CostTracker,
  processEngine: IProcessEngine,
  taskStateMachine: ITaskStateMachine,
  behaviorEngine: IBehaviorEngine,
  notificationService: NotificationService,
  suspensionManager: ISessionSuspensionManager | null = null,
  acpSessionManager: IAcpSessionManager | null = null,
): OrchestratorModule {
  const pendingWakeRepo = new SqlitePendingWakeRepository(connection);
  const wakeGateValidator = new WakeGateValidator(roleRepo, runRepo, config, logger);
  const retryScheduler = new RetryScheduler(runRepo, pendingWakeRepo, config, logger);
  const runCoordinator = new RunCoordinator(runEngine, runRepo, promptBuilder, convRepo, conversationService, orgRepo, logger);
  const taskScheduler = new TaskScheduler(taskRepo, processEngine, logger);

  const taskOrchestrator = new TaskOrchestrator(
    eventBus,
    logger,
    taskRepo,
    orgRepo,
    runRepo,
    pendingWakeRepo,
    wakeGateValidator,
    runCoordinator,
    taskScheduler,
    taskStateMachine,
    processEngine,
    behaviorEngine,
  );

  const conversationOrchestrator = new ConversationOrchestrator(
    eventBus,
    logger,
    convRepo,
    pendingWakeRepo,
    wakeGateValidator,
    runCoordinator,
    taskOrchestrator,
    notificationService,
    suspensionManager,
    conversationService,
    acpSessionManager,
  );

  const runOrchestrator = new RunOrchestrator(
    eventBus,
    logger,
    pendingWakeRepo,
    wakeGateValidator,
    retryScheduler,
    runCoordinator,
    taskOrchestrator,
  );

  container.register(PENDING_WAKE_REPO_TOKEN, { useValue: pendingWakeRepo });
  container.register(RUN_COORDINATOR_TOKEN, { useValue: runCoordinator });
  container.register(TASK_ORCHESTRATOR_TOKEN, { useValue: taskOrchestrator });
  container.register(CONVERSATION_ORCHESTRATOR_TOKEN, { useValue: conversationOrchestrator });
  container.register(RUN_ORCHESTRATOR_TOKEN, { useValue: runOrchestrator });

  return { taskOrchestrator, conversationOrchestrator, runOrchestrator, runCoordinator, wakeGateValidator };
}
