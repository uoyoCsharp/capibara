import { injectable } from 'tsyringe';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEvent } from '@core/foundation/events';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { NotificationService } from '@core/modules/notification/notification.service';
import type { IPendingWakeRepository } from '../interfaces/i-pending-wake.repository';
import type { WakeGateValidator } from '../wake-gate.validator';
import type { RunCoordinator } from '../run.coordinator';
import type { TaskOrchestrator } from './task.orchestrator';

/**
 * Conversation lifecycle coordinator.
 *
 * Handles two complementary flows when conversations need attention:
 *
 * 1. **onResponseNeeded** — A role needs to respond to a conversation.
 *    Delegates to RunCoordinator if the org's WakeGate allows it; otherwise
 *    queues a PendingWake for later dispatch by RunOrchestrator.
 *
 * 2. **onResolved** — A conversation has been resolved. Two mutually-exclusive
 *    resume paths: (a) if a SuspensionManager record matches, resume the
 *    suspended ACP session; (b) otherwise, wake the initiator role through
 *    TaskOrchestrator (which may queue a PendingWake if the gate blocks).
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
    private readonly conversationService: IConversationCommandService | null = null,
    private readonly acpSessionManager: IAcpSessionManager | null = null,
  ) {}

  start(): void {
    this.eventBus.on('conversation:response-needed', (e) => this.onResponseNeeded(e));
    this.eventBus.on('conversation:resolved', (e) => this.onResolved(e));
    this.eventBus.on('conversation:cancelled', (e) => this.onCancelled(e));
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

  /**
   * When a conversation is resolved, two mutually-exclusive resume paths exist:
   *
   * Path 1 — ACP Session Resume (SuspensionManager):
   *   If the resolved conversation is an inquiry that caused an ACP session
   *   to suspend, we restore that session with the aggregated reply. This
   *   preserves the agent's in-flight context (tool state, reasoning chain).
   *
   * Path 2 — Role Wake (pending_wakes / TaskOrchestrator):
   *   For all other conversations (e.g. human replies, non-inquiry dialogues),
   *   we wake the initiator role through TaskOrchestrator.tryWake(). If the
   *   org already has an active run, the wake is queued in pending_wakes and
   *   drained by RunOrchestrator after the current run ends.
   */
  private onResolved(event: DomainEvent<'conversation:resolved'>): void {
    const { conversationId } = event.payload;
    const conv = this.convRepo.findById(conversationId);
    if (!conv) return;

    // ── Path 1: ACP Session Resume ──────────────────────────────────
    // If an ACP session was suspended waiting for this inquiry, resume it
    // with the respondent's reply. This path is authoritative for any
    // conversation that maps to an active suspension record.
    if (this.suspensionManager && this.conversationService) {
      const suspension = this.suspensionManager.findSuspensionByInquiry(conversationId);
      if (suspension) {
        const messages = this.conversationService.getLatestMessages(conversationId, 10);
        const lastReply = [...messages].reverse().find(m => m.intent === 'reply');
        const response = lastReply?.content ?? '';

        const decision = this.suspensionManager.onInquiryResolved(conversationId, response);
        if (decision) {
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

    // ── Path 2: Role Wake (scheduling layer) ─────────────────────────
    // No suspension matched — this conversation was resolved outside of an
    // ACP inquiry flow (e.g. a human replied, or a non-inquiry dialogue).
    // Wake the initiator role so it can process the reply. If the org has
    // an active run, tryWake enqueues a PendingWake that RunOrchestrator
    // will drain after the current run ends.
    if (!conv.taskId || !conv.initiatorRoleId) return;
    this.taskOrchestrator.tryWake(conv.initiatorRoleId, conv.orgId, 'conversation_reply', conv.taskId);
  }

  /**
   * When a conversation is cancelled, cascade the cancellation to:
   *   1. The active run (if any) — cancels the in-flight ACP prompt
   *   2. The ACP session — closes the agent-side session and disconnects MCP SSE
   *   3. Pending wakes — removes queued wakes targeting this conversation
   *
   * Without this cascade, a cancelled planning conversation leaves the ACP session
   * alive; its MCP SSE client stays connected and fights with the new session's
   * client over the single SSE slot in McpHttpTransportManager.
   */
  private onCancelled(event: DomainEvent<'conversation:cancelled'>): void {
    const { conversationId } = event.payload;

    // 1. Cancel the active run for this conversation
    this.runCoordinator
      .cancelForConversation(conversationId)
      .catch((err) => {
        this.logger.error('Failed to cancel run for conversation', {
          conversationId,
          error: String(err),
        });
      });

    // 2. Close the ACP session bound to this conversation
    if (this.acpSessionManager) {
      this.acpSessionManager
        .closeByConversationId(conversationId)
        .catch((err) => {
          this.logger.error('Failed to close ACP session for conversation', {
            conversationId,
            error: String(err),
          });
        });
    }

    // 3. Remove pending wakes targeting this conversation
    this.pendingWakeRepo.deleteByConversationId(conversationId);
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
