import { container } from 'tsyringe';
import {
  CONVERSATION_REPO_TOKEN,
  CONVERSATION_MESSAGE_REPO_TOKEN,
  CONVERSATION_SERVICE_TOKEN,
  INQUIRY_ROUTER_TOKEN,
  INQUIRY_ESCALATION_SERVICE_TOKEN,
  CONVERSATION_CONTEXT_BUILDER_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import { SqliteConversationRepository } from '@core/modules/conversation/persistence/sqlite-conversation.repository';
import { SqliteConversationMessageRepository } from '@core/modules/conversation/persistence/sqlite-conversation-message.repository';
import { ConversationEventLogger } from '@core/modules/conversation/persistence/conversation-event.logger';
import { ConversationService } from '@core/modules/conversation/services/conversation.service';
import { InquiryRouter } from '@core/modules/conversation/routing/inquiry.router';
import { InquiryEscalationService } from '@core/modules/conversation/services/inquiry-escalation.service';
import { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';

export function registerConversationModule(
  connection: ISqliteConnection,
  eventBus: IEventBus,
  logger: ILogger,
  roleRepo: IRoleRepository,
): {
  conversationService: ConversationService;
  inquiryEscalationService: InquiryEscalationService;
  conversationContextBuilder: ConversationContextBuilder;
} {
  const convRepo = new SqliteConversationRepository(connection);
  const msgRepo = new SqliteConversationMessageRepository(connection);
  const eventLogger = new ConversationEventLogger(connection);
  const inquiryRouter = new InquiryRouter(roleRepo, logger);
  const conversationService = new ConversationService(convRepo, msgRepo, eventLogger, eventBus, inquiryRouter);
  const inquiryEscalationService = new InquiryEscalationService(convRepo, roleRepo, eventBus, logger);
  const conversationContextBuilder = new ConversationContextBuilder(convRepo, msgRepo);

  container.register(CONVERSATION_REPO_TOKEN, { useValue: convRepo });
  container.register(CONVERSATION_MESSAGE_REPO_TOKEN, { useValue: msgRepo });
  container.register(CONVERSATION_SERVICE_TOKEN, { useValue: conversationService });
  container.register(INQUIRY_ROUTER_TOKEN, { useValue: inquiryRouter });
  container.register(INQUIRY_ESCALATION_SERVICE_TOKEN, { useValue: inquiryEscalationService });
  container.register(CONVERSATION_CONTEXT_BUILDER_TOKEN, { useValue: conversationContextBuilder });

  return { conversationService, inquiryEscalationService, conversationContextBuilder };
}
