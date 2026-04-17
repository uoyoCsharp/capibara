import { injectable } from 'tsyringe';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

@injectable()
export class NotificationService {
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
