import { injectable } from 'tsyringe';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { PendingPlanStore, PendingPlan } from '@core/infrastructure/stores/pending-plan.store';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { BatchCreateTaskInput } from '@core/modules/workflow/types/workflow.types';

@injectable()
export class PlanningService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly taskService: TaskService,
    private readonly pendingPlanStore: PendingPlanStore,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  start(orgId: string, roleId: string, initialMessage: string): { conversationId: string } {
    const conv = this.conversationService.createPlanningOrAdhoc(
      orgId,
      'planning',
      'human',
      roleId,
      initialMessage,
    );
    return { conversationId: conv.id };
  }

  sendMessage(conversationId: string, message: string): void {
    this.conversationService.addMessage(conversationId, {
      conversationId,
      authorRoleId: null,
      authorType: 'human',
      content: message,
      intent: 'general',
    });
  }

  getPendingPlan(conversationId: string): PendingPlan | undefined {
    return this.pendingPlanStore.get(conversationId);
  }

  confirmPlan(conversationId: string, orgId: string, parentTaskId: string | null): void {
    const plan = this.pendingPlanStore.get(conversationId);
    if (!plan) {
      this.logger.warn('No pending plan to confirm', { conversationId });
      return;
    }

    const tasks = plan.tasks as BatchCreateTaskInput[];
    const created = this.taskService.batchCreate(orgId, parentTaskId, tasks);

    this.pendingPlanStore.delete(conversationId);
    this.conversationService.complete(conversationId);

    this.eventBus.emit({
      type: 'planning:plan-ready',
      timestamp: new Date().toISOString(),
      payload: { conversationId, orgId, taskCount: created.length },
    });

    this.logger.info('Plan confirmed', { conversationId, taskCount: created.length });
  }

  discardPlan(conversationId: string): void {
    this.pendingPlanStore.delete(conversationId);
    this.conversationService.cancel(conversationId);
    this.logger.info('Plan discarded', { conversationId });
  }
}
