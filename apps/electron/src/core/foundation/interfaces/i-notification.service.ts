export interface INotificationService {
  send(title: string, body: string): void;
}