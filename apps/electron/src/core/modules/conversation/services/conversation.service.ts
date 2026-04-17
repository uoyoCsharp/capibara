import { injectable } from 'tsyringe';
import type { IConversationRepository } from '../interfaces/i-conversation.repository';
import type { IConversationMessageRepository } from '../interfaces/i-conversation-message.repository';
import type { ConversationEventLogger } from '../persistence/conversation-event.logger';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { DomainEventType } from '@core/foundation/events';
import { ConversationStateError, NotFoundError } from '@core/foundation/errors/capibara.errors';
import type {
  Conversation,
  ConversationMessage,
  ConversationState,
  CreateConversationInput,
  CreateMessageInput,
  CONVERSATION_TRANSITIONS,
} from '../types/conversation.types';
import { CONVERSATION_TRANSITIONS as TRANSITIONS } from '../types/conversation.types';
import type { InquiryRouter } from '../routing/inquiry.router';

@injectable()
export class ConversationService {
  constructor(
    private readonly convRepo: IConversationRepository,
    private readonly msgRepo: IConversationMessageRepository,
    private readonly eventLogger: ConversationEventLogger,
    private readonly eventBus: IEventBus,
    private readonly inquiryRouter: InquiryRouter,
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

    const decision = this.inquiryRouter.route({
      askingRoleId: initiatorRoleId,
      orgId,
      taskId,
      questionContent,
      conversationDepth: depth ?? 0,
    });

    if (decision.respondentRoleId) {
      this.convRepo.updateRespondent(conv.id, decision.respondentRoleId, decision.respondentType);
    }

    this.transitionState(conv.id, 'waiting');
    this.eventLogger.log(conv.id, 'respondent-assigned', { respondentRoleId: decision.respondentRoleId, respondentType: decision.respondentType, auditReason: decision.auditReason });
    this.emitEvent('conversation:respondent-assigned', { conversationId: conv.id, orgId, respondentRoleId: decision.respondentRoleId });
    this.emitEvent('conversation:response-needed', { conversationId: conv.id, orgId, roleId: decision.respondentRoleId });

    return this.convRepo.findById(conv.id)!;
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

  addMessage(conversationId: string, input: CreateMessageInput): ConversationMessage {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) throw new NotFoundError('Conversation', conversationId);

    const msg = this.msgRepo.create(input);
    this.emitEvent('conversation:message-added', { conversationId, messageId: msg.id, authorType: input.authorType });

    const needsResponse = this.determineResponseNeeded(conv, input);
    if (needsResponse) {
      this.emitEvent('conversation:response-needed', { conversationId, orgId: conv.orgId, roleId: conv.respondentRoleId });
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
    this.transitionState(conversationId, 'completed');
    this.eventLogger.log(conversationId, 'completed');
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
      return input.authorType === 'ai' && input.intent === 'question' && conv.state === 'waiting';
    }
    return input.authorType === 'human';
  }

  private emitEvent(type: DomainEventType, payload: Record<string, unknown>): void {
    this.eventBus.emit({ type, timestamp: new Date().toISOString(), payload });
  }
}
