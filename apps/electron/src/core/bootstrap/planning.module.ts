import { container } from 'tsyringe';
import { PLANNING_SERVICE_TOKEN } from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import { PlanningService } from '@core/modules/planning/planning.service';

export function registerPlanningModule(
  conversationService: ConversationService,
  taskService: TaskService,
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  logger: ILogger,
): { planningService: PlanningService } {
  const planningService = new PlanningService(
    conversationService,
    taskService,
    eventBus,
    eventPublisher,
    logger,
  );

  container.register(PLANNING_SERVICE_TOKEN, { useValue: planningService });

  return { planningService };
}
