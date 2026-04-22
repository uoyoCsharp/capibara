import { injectable } from 'tsyringe';
import type { IConversationRepository } from '../interfaces/i-conversation.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEventType } from '@core/foundation/events';

@injectable()
export class InquiryEscalationService {
  constructor(
    private readonly convRepo: IConversationRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  scanAndEscalate(): number {
    const timedOut = this.convRepo.findTimedOutInquiries();
    let escalatedCount = 0;

    for (const conv of timedOut) {
      this.convRepo.updateState(conv.id, 'timed_out');
      this.emitEvent('conversation:timed-out', { conversationId: conv.id, orgId: conv.orgId });

      const escalated = this.attemptEscalation(conv.id, conv.respondentRoleId, conv.orgId);
      if (escalated) {
        escalatedCount++;
      }
    }

    if (timedOut.length > 0) {
      this.logger.info('Escalation scan completed', { scanned: timedOut.length, escalated: escalatedCount });
    }

    return escalatedCount;
  }

  private attemptEscalation(conversationId: string, currentRespondentId: string | null, orgId: string): boolean {
    if (!currentRespondentId) return false;

    const respondent = this.roleRepo.findById(currentRespondentId);
    if (!respondent?.parentId) return false;

    const parent = this.roleRepo.findById(respondent.parentId);
    if (!parent || parent.status !== 'active') return false;

    this.convRepo.updateState(conversationId, 'escalated');
    this.convRepo.updateRespondent(conversationId, parent.id, respondent.requiresHumanApproval ? 'human' : 'ai');
    this.emitEvent('conversation:escalated', { conversationId, orgId, newRespondentRoleId: parent.id });
    return true;
  }

  private emitEvent(type: DomainEventType, payload: Record<string, unknown>): void {
    this.eventBus.emit({ type, timestamp: new Date().toISOString(), payload });
  }
}
