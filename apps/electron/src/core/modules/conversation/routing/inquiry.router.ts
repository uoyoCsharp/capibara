import { injectable } from 'tsyringe';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { RoutingRequest, RoutingDecision } from '../types/conversation.types';

@injectable()
export class InquiryRouter {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly logger: ILogger,
  ) {}

  route(request: RoutingRequest): RoutingDecision {
    const askingRole = this.roleRepo.findById(request.askingRoleId);
    if (!askingRole) {
      return this.humanFallback('Asking role not found');
    }

    if (askingRole.parentId) {
      const parent = this.roleRepo.findById(askingRole.parentId);
      if (parent && parent.status === 'active') {
        return {
          respondentRoleId: parent.id,
          respondentType: parent.requiresHumanApproval ? 'human' : 'ai',
          priority: 0,
          auditReason: `Routed to parent role: ${parent.name}`,
        };
      }
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
        respondentType: candidate.requiresHumanApproval ? 'human' : 'ai',
        priority: 1,
        auditReason: `Routed to peer role: ${candidate.name}`,
      };
    }

    return this.humanFallback('No available AI role found for routing');
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
