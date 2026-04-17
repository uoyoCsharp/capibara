import { container } from 'tsyringe';
import {
  NOTIFICATION_SERVICE_TOKEN,
  EVENT_BROADCASTER_TOKEN,
  EVENT_DIGESTER_TOKEN,
} from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import { EventBroadcaster } from '@core/modules/notification/event-broadcaster';
import { NotificationService } from '@core/modules/notification/notification.service';
import { EventDigester } from '@core/modules/notification/event-digester';

export function registerNotificationModule(
  eventBus: IEventBus,
  logger: ILogger,
): { eventBroadcaster: EventBroadcaster; notificationService: NotificationService; eventDigester: EventDigester } {
  const eventBroadcaster = new EventBroadcaster(eventBus, logger);
  const notificationService = new NotificationService(logger);
  const eventDigester = new EventDigester();

  container.register(EVENT_BROADCASTER_TOKEN, { useValue: eventBroadcaster });
  container.register(NOTIFICATION_SERVICE_TOKEN, { useValue: notificationService });
  container.register(EVENT_DIGESTER_TOKEN, { useValue: eventDigester });

  return { eventBroadcaster, notificationService, eventDigester };
}
