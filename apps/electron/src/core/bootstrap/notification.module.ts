import { container } from 'tsyringe';
import {
  NOTIFICATION_SERVICE_TOKEN,
  EVENT_BROADCASTER_TOKEN,
} from '@core/foundation/tokens';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import { EventBroadcaster } from '@core/infrastructure/notification/event-broadcaster';
import { NotificationService } from '@core/infrastructure/notification/notification.service';

export function registerNotificationModule(
  eventBus: IEventBus,
  logger: ILogger,
): { eventBroadcaster: EventBroadcaster; notificationService: NotificationService } {
  const eventBroadcaster = new EventBroadcaster(eventBus, logger);
  const notificationService = new NotificationService(logger);

  container.register(EVENT_BROADCASTER_TOKEN, { useValue: eventBroadcaster });
  container.register(NOTIFICATION_SERVICE_TOKEN, { useValue: notificationService });

  return { eventBroadcaster, notificationService };
}
