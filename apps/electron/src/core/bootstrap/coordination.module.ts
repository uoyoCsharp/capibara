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
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import { InquiryRouter } from '@core/modules/coordination/routing/inquiry.router';
import { InquiryEscalationService } from '@core/modules/coordination/routing/inquiry-escalation.service';

export interface CoordinationModule {
  inquiryRouter: InquiryRouter;
  inquiryEscalationService: InquiryEscalationService;
}

export function registerCoordinationModule(
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  logger: ILogger,
  roleRepo: IRoleRepository,
  convRepo: IConversationRepository,
  conversationService: IConversationCommandService,
): CoordinationModule {
  const inquiryRouter = new InquiryRouter(roleRepo, conversationService, eventBus, logger);
  const inquiryEscalationService = new InquiryEscalationService(convRepo, roleRepo, eventPublisher, logger);

  container.register(INQUIRY_ROUTER_TOKEN, { useValue: inquiryRouter });
  container.register(INQUIRY_ESCALATION_SERVICE_TOKEN, { useValue: inquiryEscalationService });

  return { inquiryRouter, inquiryEscalationService };
}
