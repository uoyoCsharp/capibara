import { container } from 'tsyringe';
import { PLANNING_SERVICE_TOKEN } from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import { PlanningService } from '@core/modules/planning/planning.service';

export function registerPlanningModule(
  taskService: TaskService,
  taskStateMachine: TaskStateMachine,
  processEngine: ProcessEngine,
  connection: ISqliteConnection,
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  logger: ILogger,
): { planningService: PlanningService } {
  const planningService = new PlanningService(
    taskService,
    taskStateMachine,
    processEngine,
    connection,
    eventBus,
    eventPublisher,
    logger,
  );

  container.register(PLANNING_SERVICE_TOKEN, { useValue: planningService });

  return { planningService };
}
