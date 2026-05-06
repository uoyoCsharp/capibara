import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IPendingWakeRepository } from '../interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '../wake-gate.validator';
import type { RunCoordinator } from '../run.coordinator';
import type { TaskOrchestrator } from './task.orchestrator';

/**
 * Conversation lifecycle coordinator. Responsible only for deciding when to
 * wake a Role in response to conversation activity and delegating execution
 * to RunCoordinator. Delegates task-level side effects (continuing a Task
 * after an inquiry resolves) back to TaskOrchestrator.
 */
@injectable()
export class ConversationOrchestrator {
  private locale = 'en-US';

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly convRepo: IConversationRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly wakeGateValidator: WakeGateValidator,
    private readonly runCoordinator: RunCoordinator,
    private readonly taskOrchestrator: TaskOrchestrator,
  ) {}

  start(): void {
    this.eventBus.on('conversation:response-needed', (e) => this.onResponseNeeded(e));
    this.eventBus.on('conversation:resolved', (e) => this.onResolved(e));
    this.logger.info('ConversationOrchestrator started');
  }

  private onResponseNeeded(event: DomainEvent<'conversation:response-needed'>): void {
    const { conversationId, orgId, roleId } = event.payload;
    if (!roleId) return;

    const gate = this.wakeGateValidator.validate(roleId, orgId);
    if (!gate.allowed) {
      // Queue the wake so RunOrchestrator.drainPendingWakes dispatches it
      // after the currently-active run finishes. Without this, AI→AI
      // inquiries vanish whenever the asker's run is still in flight.
      this.pendingWakeRepo.create({
        roleId,
        orgId,
        reason: 'respondent_woken',
        taskId: null,
        conversationId,
        priority: 0,
      });
      this.logger.info('Conversation wake queued (gate blocked)', { conversationId, roleId, reason: gate.reason });
      return;
    }

    this.runCoordinator
      .executeForConversation(conversationId, roleId, orgId, this.locale)
      .catch((err) => {
        this.logger.error('RunCoordinator failed for conversation', { conversationId, error: String(err) });
      });
  }

  private onResolved(event: DomainEvent<'conversation:resolved'>): void {
    const { conversationId } = event.payload;
    const conv = this.convRepo.findById(conversationId);
    if (!conv?.taskId || !conv.initiatorRoleId) return;

    this.taskOrchestrator.tryWake(conv.initiatorRoleId, conv.orgId, 'conversation_reply', conv.taskId);
  }
}
