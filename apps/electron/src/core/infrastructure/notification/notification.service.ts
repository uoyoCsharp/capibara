import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { INotificationService } from '@core/foundation/interfaces/i-notification.service';

@injectable()
export class NotificationService implements INotificationService {
  constructor(private readonly logger: ILogger) {}

  send(title: string, body: string): void {
    try {
      const { Notification } = require('electron') as typeof import('electron');
      if (Notification.isSupported()) {
        const notification = new Notification({ title, body });
        notification.show();
      }
    } catch {
      this.logger.debug('Desktop notifications not available');
    }
  }
}