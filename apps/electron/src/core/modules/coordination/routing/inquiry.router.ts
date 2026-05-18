import { injectable } from 'tsyringe';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEvent } from '@core/foundation/events';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RoutingRequest, RoutingDecision } from './routing.types';

/**
 * Layer 2 coordinator. Subscribes to `conversation:needs-routing` events
 * emitted by the Conversation module. Reads Organization data to decide
 * which Role should respond, then calls ConversationService.assignRespondent
 * to write the decision back.
 *
 * Conversation module has no knowledge of this component — the coupling
 * flows entirely through events + a narrow write-back API.
 */
@injectable()
export class InquiryRouter {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly conversationService: ConversationService,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    this.eventBus.on('conversation:needs-routing', (e) => this.handle(e));
    this.logger.info('InquiryRouter started');
  }

  private handle(event: DomainEvent<'conversation:needs-routing'>): void {
    const { conversationId, orgId, askingRoleId, taskId, conversationDepth } = event.payload;

    try {
      const decision = this.route({ conversationId, askingRoleId, orgId, taskId, conversationDepth });
      this.conversationService.assignRespondent(
        conversationId,
        decision.respondentRoleId,
        decision.respondentType,
        decision.auditReason,
      );
    } catch (err) {
      this.logger.error('InquiryRouter failed', { conversationId, error: String(err) });
    }
  }

  private route(request: RoutingRequest): RoutingDecision {
    const askingRole = this.roleRepo.findById(request.askingRoleId);
    if (!askingRole) {
      return this.humanFallback('Asking role not found');
    }

    if (askingRole.requiresHumanApproval) {
      return {
        respondentRoleId: null,
        respondentType: 'human',
        priority: 0,
        auditReason: `Role "${askingRole.name}" requires human approval`,
      };
    }

    const ancestor = this.findActiveAncestor(askingRole.parentId);
    if (ancestor) {
      const isDirectParent = ancestor.id === askingRole.parentId;
      return {
        respondentRoleId: ancestor.id,
        respondentType: 'ai',
        priority: 0,
        auditReason: isDirectParent
          ? `Routed to parent role: ${ancestor.name}`
          : `Routed to ancestor role (parent unavailable): ${ancestor.name}`,
      };
    }

    const siblings = askingRole.parentId
      ? this.roleRepo.findChildren(askingRole.parentId)
      : this.roleRepo.findByOrgId(askingRole.orgId);

    const candidate = siblings.find(
      (r) => r.id !== askingRole.id && r.status === 'active' && !r.isSystemRole,
    );

    if (candidate) {
      return {
        respondentRoleId: candidate.id,
        respondentType: 'ai',
        priority: 1,
        auditReason: `Routed to peer role: ${candidate.name}`,
      };
    }

    return this.humanFallback('No available AI role found for routing');
  }

  // Walks up the role tree until it finds an active, non-system ancestor.
  // Falling through paused/missing parents lets inquiries reach a real
  // decision-maker instead of dropping to human whenever the direct
  // supervisor happens to be paused.
  private findActiveAncestor(parentId: string | null): { id: string; name: string } | null {
    const seen = new Set<string>();
    let currentId = parentId;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const role = this.roleRepo.findById(currentId);
      if (!role) return null;
      if (role.status === 'active' && !role.isSystemRole) {
        return { id: role.id, name: role.name };
      }
      currentId = role.parentId;
    }
    return null;
  }

  private humanFallback(reason: string): RoutingDecision {
    this.logger.warn('Inquiry routing fell back to human', { reason });
    return {
      respondentRoleId: null,
      respondentType: 'human',
      priority: 10,
      auditReason: `Human fallback: ${reason}`,
    };
  }
}
