import { Notification, BrowserWindow } from 'electron';
import { injectable, inject } from 'tsyringe';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import { EVENT_BUS_TOKEN, LOGGER_TOKEN } from '@main/core/tokens.js';
import { IPC_CHANNELS } from '@shared/contracts.js';

/**
 * Sends Electron native desktop notifications in response to domain events.
 *
 * Handles:
 * - approval:required → Human approval needed notification
 * - escalation:top-level → Mandatory high-priority safety valve notification
 * - budget:exceeded → Budget warning notification
 *
 * Clicking a notification brings the app to focus and emits a renderer
 * navigation event so the UI can scroll to the relevant discussion group.
 *
 * See Architecture §8.3 — Desktop Notifications.
 */
@injectable()
export class NotificationService {
  constructor(
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  start(): void {
    this.eventBus.on('approval:required', (e: DomainEvent) => this.onApprovalRequired(e));
    this.eventBus.on('escalation:top-level', (e: DomainEvent) => this.onEscalationTopLevel(e));
    this.eventBus.on('budget:exceeded', (e: DomainEvent) => this.onBudgetExceeded(e));
    this.logger.info('NotificationService started');
  }

  private onApprovalRequired(event: DomainEvent): void {
    const { taskTitle, roleName, orgId, groupId } = event.payload as {
      taskId: string;
      taskTitle: string;
      orgId: string;
      roleId: string;
      roleName: string;
      groupId: string;
    };

    this.sendNotification({
      title: 'Approval Required',
      body: `"${taskTitle}" needs approval from ${roleName}`,
      urgency: 'normal',
      navigateTo: { orgId, groupId },
    });
  }

  private onEscalationTopLevel(event: DomainEvent): void {
    const { roleId, roleName, orgId, taskId, taskTitle, escalationChain, failureReason } =
      event.payload as {
        roleId: string;
        roleName: string;
        orgId: string;
        taskId: string;
        taskTitle: string;
        escalationChain: string[];
        failureReason: string;
      };

    this.sendNotification({
      title: 'Critical: Top-Level Escalation',
      body: `Unresolved issue on "${taskTitle}" reached ${roleName}. Reason: ${failureReason}`,
      urgency: 'critical',
      navigateTo: { orgId, taskId },
    });
  }

  private onBudgetExceeded(event: DomainEvent): void {
    const { orgId, totalCost, limit } = event.payload as {
      orgId: string; totalCost: number; limit: number;
    };

    this.sendNotification({
      title: 'Budget Limit Reached',
      body: `Budget exceeded. All roles paused.`,
      urgency: 'critical',
      navigateTo: { orgId },
    });

    // Send budget:roles-paused event so the renderer can show resume UI
    this.sendRendererEvent({
      type: 'budget:roles-paused',
      orgId,
      totalCost,
      budgetLimit: limit,
    });
  }

  private sendNotification(opts: {
    title: string;
    body: string;
    urgency: 'normal' | 'critical';
    navigateTo: Record<string, string>;
  }): void {
    if (!Notification.isSupported()) {
      this.logger.warn('Desktop notifications not supported on this platform');
      return;
    }

    const notification = new Notification({
      title: opts.title,
      body: opts.body,
      urgency: opts.urgency,
      silent: opts.urgency !== 'critical',
    });

    notification.on('click', () => {
      this.focusAndNavigate(opts.navigateTo);
    });

    notification.show();
    this.logger.info('Desktop notification sent', { title: opts.title });

    // Also forward to renderer as DesktopEvent
    this.sendRendererEvent({
      type: 'notification',
      title: opts.title,
      body: opts.body,
    });

    // Send approval-specific event for UI badge/panel updates
    if (opts.navigateTo.groupId) {
      this.sendRendererEvent({
        type: 'approval:required',
        taskId: opts.navigateTo.taskId ?? '',
        taskTitle: '',
        orgId: opts.navigateTo.orgId ?? '',
        roleId: '',
        roleName: '',
        groupId: opts.navigateTo.groupId,
      });
    }
  }

  private focusAndNavigate(params: Record<string, string>): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    const win = windows[0];
    if (win.isMinimized()) win.restore();
    win.focus();

    // Send navigation event to renderer
    win.webContents.send(IPC_CHANNELS.rendererEvent, {
      type: 'discussion:changed',
      orgId: params.orgId ?? '',
    });
  }

  private sendRendererEvent(event: Record<string, unknown>): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.rendererEvent, event);
    }
  }
}
