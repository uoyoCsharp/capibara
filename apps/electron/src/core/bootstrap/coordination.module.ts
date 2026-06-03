import { container } from 'tsyringe';
import {
  INQUIRY_ROUTER_TOKEN,
  INQUIRY_ESCALATION_SERVICE_TOKEN,
} from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import { InquiryOrchestrator } from '@core/modules/coordination/routing/inquiry.orchestrator';
import { InquiryEscalationService } from '@core/modules/coordination/routing/inquiry-escalation.service';

export interface CoordinationModule {
  inquiryOrchestrator: InquiryOrchestrator;
  inquiryEscalationService: InquiryEscalationService;
}

export function registerCoordinationModule(
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  logger: ILogger,
  roleRepo: IRoleRepository,
  convRepo: IConversationRepository,
): CoordinationModule {
  const inquiryOrchestrator = new InquiryOrchestrator(roleRepo, eventPublisher, eventBus, logger);
  const inquiryEscalationService = new InquiryEscalationService(convRepo, roleRepo, eventPublisher, logger);

  container.register(INQUIRY_ROUTER_TOKEN, { useValue: inquiryOrchestrator });
  container.register(INQUIRY_ESCALATION_SERVICE_TOKEN, { useValue: inquiryEscalationService });

  return { inquiryOrchestrator, inquiryEscalationService };
}
