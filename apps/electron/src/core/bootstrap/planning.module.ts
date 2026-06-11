import { container } from 'tsyringe';
import { PLANNING_SERVICE_TOKEN } from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ITaskService } from '@core/modules/workflow/interfaces/i-task.service';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { IRoleQueryService } from '@core/modules/organization/interfaces/i-role-query.service';
import { PlanningService } from '@core/modules/planning/planning.service';
import { SqlitePendingPlanTreeRepository } from '@core/modules/planning/persistence/sqlite-pending-plan-tree.repository';

export interface PlanningModule {
  planningService: PlanningService;
}

export function registerPlanningModule(
  taskService: ITaskService,
  taskStateMachine: ITaskStateMachine,
  processEngine: IProcessEngine,
  connection: ISqliteConnection,
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  logger: ILogger,
  conversationService: IConversationCommandService,
  roleService: IRoleQueryService,
): PlanningModule {
  const pendingPlanTreeRepo = new SqlitePendingPlanTreeRepository(connection);

  const planningService = new PlanningService(
    taskService,
    taskStateMachine,
    processEngine,
    connection,
    eventBus,
    eventPublisher,
    logger,
    pendingPlanTreeRepo,
    conversationService,
    roleService,
  );

  container.register(PLANNING_SERVICE_TOKEN, { useValue: planningService });

  return { planningService };
}
