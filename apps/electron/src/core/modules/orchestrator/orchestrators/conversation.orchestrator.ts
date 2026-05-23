import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { NotificationService } from '@core/modules/notification/notification.service';
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
    private readonly notificationService: NotificationService,
    private readonly suspensionManager: ISessionSuspensionManager | null = null,
    private readonly conversationService: ConversationService | null = null,
  ) {}

  start(): void {
    this.eventBus.on('conversation:response-needed', (e) => this.onResponseNeeded(e));
    this.eventBus.on('conversation:resolved', (e) => this.onResolved(e));
    this.logger.info('ConversationOrchestrator started');
  }

  private onResponseNeeded(event: DomainEvent<'conversation:response-needed'>): void {
    const { conversationId, orgId, roleId } = event.payload;
    if (!roleId) {
      this.notifyHumanFallback(conversationId);
      return;
    }

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
    if (!conv) return;

    // Check if a session suspension is waiting for this inquiry to be resolved
    if (this.suspensionManager && this.conversationService) {
      const suspension = this.suspensionManager.findSuspensionByInquiry(conversationId);
      if (suspension) {
        // Extract the response text from the conversation
        const messages = this.conversationService.getLatestMessages(conversationId, 10);
        const lastReply = [...messages].reverse().find(m => m.intent === 'reply');
        const response = lastReply?.content ?? '';

        const decision = this.suspensionManager.onInquiryResolved(conversationId, response);
        if (decision) {
          // Publish run:resumed event before triggering the resume run
          this.eventBus.emit({
            type: 'run:resumed',
            timestamp: new Date().toISOString(),
            payload: {
              runId: decision.runId,
              orgId: decision.orgId,
              roleId: decision.roleId,
              resumedFromSuspensionId: decision.suspensionId,
            },
          });

          // All inquiries resolved — resume the suspended session
          this.runCoordinator
            .executeResume(decision, this.locale)
            .catch((err) => {
              this.logger.error('Failed to resume suspended session', {
                suspensionId: decision.suspensionId,
                error: String(err),
              });
            });
        }
        return;
      }
    }

    // Original behavior: wake the initiator to continue the task
    if (!conv.taskId || !conv.initiatorRoleId) return;
    this.taskOrchestrator.tryWake(conv.initiatorRoleId, conv.orgId, 'conversation_reply', conv.taskId);
  }

  private notifyHumanFallback(conversationId: string): void {
    const conv = this.convRepo.findById(conversationId);
    const title = conv?.type === 'inquiry'
      ? 'AI inquiry needs your answer'
      : 'Conversation needs your reply';
    const body = conv?.type === 'inquiry'
      ? 'An AI role asked a question and routing fell back to human. Open the inbox to reply.'
      : 'A conversation is waiting for your input. Open the inbox to reply.';
    this.notificationService.send(title, body);
    this.logger.info('Conversation routed to human, notification sent', { conversationId, type: conv?.type });
  }
}
