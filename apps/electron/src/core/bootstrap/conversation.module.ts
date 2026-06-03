import { container } from 'tsyringe';
import {
  CONVERSATION_REPO_TOKEN,
  CONVERSATION_MESSAGE_REPO_TOKEN,
  CONVERSATION_SERVICE_TOKEN,
  CONVERSATION_CONTEXT_BUILDER_TOKEN,
} from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import { SqliteConversationRepository } from '@core/modules/conversation/persistence/sqlite-conversation.repository';
import { SqliteConversationMessageRepository } from '@core/modules/conversation/persistence/sqlite-conversation-message.repository';
import { ConversationEventLogger } from '@core/modules/conversation/persistence/conversation-event.logger';
import { ConversationService } from '@core/modules/conversation/services/conversation.service';
import { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';

export function registerConversationModule(
  connection: ISqliteConnection,
  eventBus: IEventBus,
  eventPublisher: IEventPublisher,
  _logger: ILogger,
): {
  conversationService: ConversationService;
  conversationRepo: SqliteConversationRepository;
  conversationContextBuilder: ConversationContextBuilder;
} {
  const convRepo = new SqliteConversationRepository(connection);
  const msgRepo = new SqliteConversationMessageRepository(connection);
  const eventLogger = new ConversationEventLogger(connection);
  const conversationService = new ConversationService(
    convRepo,
    msgRepo,
    eventLogger,
    eventPublisher,
    eventBus,
  );
  const conversationContextBuilder = new ConversationContextBuilder(convRepo, msgRepo);

  container.register(CONVERSATION_REPO_TOKEN, { useValue: convRepo });
  container.register(CONVERSATION_MESSAGE_REPO_TOKEN, { useValue: msgRepo });
  container.register(CONVERSATION_SERVICE_TOKEN, { useValue: conversationService });
  container.register(CONVERSATION_CONTEXT_BUILDER_TOKEN, { useValue: conversationContextBuilder });

  return { conversationService, conversationRepo: convRepo, conversationContextBuilder };
}
