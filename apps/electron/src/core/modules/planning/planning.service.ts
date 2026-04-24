import { injectable } from 'tsyringe';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEvent, PlanTaskDraft } from '@core/foundation/events';
import type { BatchCreateTaskInput } from '@core/modules/workflow/types/workflow.types';

export interface PendingPlan {
  conversationId: string;
  orgId: string;
  roleId: string;
  tasks: PlanTaskDraft[];
  submittedAt: string;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Owns the full planning flow end-to-end. In v2.1 the "pending plan" state
 * is this service's own private map — AI submissions arrive via the
 * `plan:submitted` event (no shared Infrastructure store).
 */
@injectable()
export class PlanningService {
  private readonly pendingPlans = new Map<string, PendingPlan>();

  constructor(
    private readonly conversationService: ConversationService,
    private readonly taskService: TaskService,
    private readonly eventBus: IEventBus,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  /**
   * Subscribe to `plan:submitted` events. Called once at bootstrap.
   * Named `init` to avoid colliding with the public `start(orgId, ...)`
   * call that kicks off a planning conversation.
   */
  init(): void {
    this.eventBus.on('plan:submitted', (e) => this.onPlanSubmitted(e));
    this.logger.info('PlanningService initialized');
  }

  // ─── Public API ──────────────────────────────────────────────

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
    const plan = this.pendingPlans.get(conversationId);
    if (!plan) return undefined;
    if (Date.now() - new Date(plan.submittedAt).getTime() > MAX_AGE_MS) {
      this.pendingPlans.delete(conversationId);
      return undefined;
    }
    return plan;
  }

  confirmPlan(conversationId: string, orgId: string, parentTaskId: string | null): void {
    const plan = this.pendingPlans.get(conversationId);
    if (!plan) {
      this.logger.warn('No pending plan to confirm', { conversationId });
      return;
    }

    const tasks = plan.tasks as BatchCreateTaskInput[];
    const created = this.taskService.batchCreate(orgId, parentTaskId, tasks);

    this.pendingPlans.delete(conversationId);
    this.conversationService.complete(conversationId);

    this.eventPublisher.publish('planning:plan-ready', {
      conversationId,
      orgId,
      taskCount: created.length,
    });

    this.logger.info('Plan confirmed', { conversationId, taskCount: created.length });
  }

  discardPlan(conversationId: string): void {
    this.pendingPlans.delete(conversationId);
    this.conversationService.cancel(conversationId);
    this.logger.info('Plan discarded', { conversationId });
  }

  // ─── Event handler ───────────────────────────────────────────

  private onPlanSubmitted(event: DomainEvent<'plan:submitted'>): void {
    const { conversationId, orgId, roleId, tasks, submittedAt } = event.payload;
    this.pendingPlans.set(conversationId, {
      conversationId,
      orgId,
      roleId,
      tasks,
      submittedAt,
    });
    this.logger.info('Pending plan recorded', { conversationId, taskCount: tasks.length });
  }
}
