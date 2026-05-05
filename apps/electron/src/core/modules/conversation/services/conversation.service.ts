import { injectable } from 'tsyringe';
import type { IConversationRepository } from '../interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '../interfaces/i-conversation-message.repository';
import type { ConversationEventLogger } from '../persistence/conversation-event.logger';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { DomainEventMap, DomainEventType } from '@core/foundation/events';
import { ConversationStateError, NotFoundError } from '@core/foundation/errors/capibara.errors';
import type {
  Conversation,
  ConversationMessage,
  ConversationState,
  CreateMessageInput,
  RespondentType,
} from '../types/conversation.types';
import { CONVERSATION_TRANSITIONS as TRANSITIONS } from '../types/conversation.types';

@injectable()
export class ConversationService {
  constructor(
    private readonly convRepo: IConversationRepository,
    private readonly msgRepo: IConversationMessageRepository,
    private readonly eventLogger: ConversationEventLogger,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  findById(id: string): Conversation | null {
    return this.convRepo.findById(id);
  }

  findByOrgId(orgId: string): Conversation[] {
    return this.convRepo.findByOrgId(orgId);
  }

  findActiveByOrgId(orgId: string): Conversation[] {
    return this.convRepo.findActiveByOrgId(orgId);
  }

  findByTaskId(taskId: string): Conversation[] {
    return this.convRepo.findByTaskId(taskId);
  }

  getMessages(conversationId: string): ConversationMessage[] {
    return this.msgRepo.findByConversationId(conversationId);
  }

  getLatestMessages(conversationId: string, limit: number): ConversationMessage[] {
    return this.msgRepo.findLatest(conversationId, limit);
  }

  createInquiry(
    orgId: string,
    initiatorRoleId: string,
    taskId: string,
    questionContent: string,
    parentConversationId?: string,
    depth?: number,
  ): Conversation {
    const conv = this.convRepo.create({
      orgId,
      type: 'inquiry',
      initiatorRoleId,
      taskId,
      parentConversationId: parentConversationId ?? null,
    });

    this.msgRepo.create({
      conversationId: conv.id,
      authorRoleId: initiatorRoleId,
      authorType: 'ai',
      content: questionContent,
      intent: 'question',
    });

    // Conversation is left in 'active' state with no respondent. Layer 2
    // InquiryRouter subscribes to this event, reads Organization data, and
    // calls assignRespondent() to complete the routing decision.
    this.emitEvent('conversation:needs-routing', {
      conversationId: conv.id,
      orgId,
      askingRoleId: initiatorRoleId,
      taskId,
      conversationDepth: depth ?? 0,
    });

    return this.convRepo.findById(conv.id)!;
  }

  /**
   * Writes back the routing decision. Called by Layer 2 InquiryRouter after
   * reading Organization data to pick a respondent.
   *
   * Publishes conversation:respondent-assigned + conversation:response-needed
   * so Orchestrator can dispatch a Run to the respondent.
   */
  assignRespondent(
    conversationId: string,
    respondentRoleId: string | null,
    respondentType: RespondentType,
    auditReason: string,
  ): void {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);

    this.convRepo.updateRespondent(conversationId, respondentRoleId, respondentType);
    this.transitionState(conversationId, 'waiting');
    this.eventLogger.log(conversationId, 'respondent-assigned', {
      respondentRoleId,
      respondentType,
      auditReason,
    });
    this.emitEvent('conversation:respondent-assigned', {
      conversationId,
      orgId: conv.orgId,
      respondentRoleId,
    });
    this.emitEvent('conversation:response-needed', {
      conversationId,
      orgId: conv.orgId,
      roleId: respondentRoleId,
    });
  }

  createPlanningOrAdhoc(
    orgId: string,
    type: 'planning' | 'adhoc',
    initiatorRoleId: string,
    respondentRoleId: string,
    initialMessage: string,
    taskId?: string,
  ): Conversation {
    const conv = this.convRepo.create({
      orgId,
      type,
      initiatorRoleId,
      respondentRoleId,
      respondentType: 'ai',
      taskId: taskId ?? null,
    });

    this.msgRepo.create({
      conversationId: conv.id,
      authorRoleId: null,
      authorType: 'human',
      content: initialMessage,
      intent: 'general',
    });

    this.emitEvent('conversation:created', { conversationId: conv.id, orgId, type });
    this.emitEvent('conversation:response-needed', { conversationId: conv.id, orgId, roleId: respondentRoleId });

    return conv;
  }

  /**
   * Create a plan_review conversation for inbox-driven tree review.
   * respondentType is 'human' since the user must approve/refine/discard.
   */
  createPlanReview(
    orgId: string,
    initiatorRoleId: string,
    rootTaskId: string,
    pendingPlanId: string,
    currentVersion: number,
  ): Conversation {
    const conv = this.convRepo.create({
      orgId,
      type: 'plan_review',
      initiatorRoleId,
      respondentRoleId: null,
      respondentType: 'human',
      taskId: rootTaskId,
      metadata: { pendingPlanId, rootTaskId, currentVersion },
    });

    this.msgRepo.create({
      conversationId: conv.id,
      authorRoleId: initiatorRoleId,
      authorType: 'ai',
      content: `Decomposition plan submitted (version ${currentVersion}). Awaiting review.`,
      intent: 'general',
    });

    this.emitEvent('conversation:created', { conversationId: conv.id, orgId, type: 'plan_review' });

    return conv;
  }

  addMessage(conversationId: string, input: CreateMessageInput): ConversationMessage {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);

    const msg = this.msgRepo.create(input);
    this.emitEvent('conversation:message-added', { conversationId, orgId: conv.orgId, messageId: msg.id, authorType: input.authorType });

    const needsResponse = this.determineResponseNeeded(conv, input);
    if (needsResponse) {
      const targetRoleId = conv.type === 'inquiry' && input.authorType === 'human'
        ? conv.initiatorRoleId
        : conv.respondentRoleId;
      this.emitEvent('conversation:response-needed', { conversationId, orgId: conv.orgId, roleId: targetRoleId });
    }

    return msg;
  }

  resolve(conversationId: string): void {
    this.transitionState(conversationId, 'resolved');
    this.eventLogger.log(conversationId, 'resolved');
    this.emitEvent('conversation:resolved', { conversationId });
  }

  cancel(conversationId: string): void {
    this.transitionState(conversationId, 'cancelled');
    this.eventLogger.log(conversationId, 'cancelled');
    this.emitEvent('conversation:cancelled', { conversationId });
  }

  complete(conversationId: string): void {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);
    this.transitionState(conversationId, 'completed');
    this.eventLogger.log(conversationId, 'completed');
    this.emitEvent('conversation:completed', { conversationId, orgId: conv.orgId });
  }

  escalate(conversationId: string, newRespondentRoleId: string): void {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);

    this.transitionState(conversationId, 'escalated');
    this.convRepo.updateRespondent(conversationId, newRespondentRoleId, 'ai');
    this.eventLogger.log(conversationId, 'escalated', { newRespondentRoleId });
    this.emitEvent('conversation:escalated', { conversationId, orgId: conv.orgId, newRespondentRoleId });
  }

  updateExternalSessionId(conversationId: string, sessionId: string): void {
    this.convRepo.updateExternalSessionId(conversationId, sessionId);
  }

  private transitionState(conversationId: string, newState: ConversationState): void {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);

    const valid = TRANSITIONS.some((t) => t.from === conv.state && t.to === newState);
    if (!valid) {
      throw new ConversationStateError(conversationId, conv.state, newState);
    }

    this.convRepo.updateState(conversationId, newState);
  }

  private determineResponseNeeded(conv: Conversation, input: CreateMessageInput): boolean {
    if (conv.type === 'inquiry') {
      if (input.authorType === 'human') return true;
      return input.intent === 'question' && conv.state === 'waiting';
    }
    return input.authorType === 'human';
  }

  private emitEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
    this.eventPublisher.publish(type, payload);
  }
}
