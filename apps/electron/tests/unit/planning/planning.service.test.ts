import { describe, it, expect, beforeEach } from 'vitest';
import { PlanningService } from '@core/modules/planning/planning.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { PlanTaskDraft } from '@core/foundation/events';

describe('PlanningService', () => {
  let bus: MockEventBus;
  let conversationService: ConversationService;
  let taskService: TaskService;
  let service: PlanningService;

  function emitSubmitted(conversationId: string, orgId: string, tasks: PlanTaskDraft[], submittedAt?: string): void {
    bus.emit({
      type: 'plan:submitted',
      timestamp: new Date().toISOString(),
      payload: {
        conversationId,
        orgId,
        roleId: 'role-planner',
        tasks,
        submittedAt: submittedAt ?? new Date().toISOString(),
      },
    });
  }

  beforeEach(() => {
    bus = new MockEventBus();
    conversationService = {
      createPlanningOrAdhoc: vi.fn().mockReturnValue({ id: 'conv-1' }),
      addMessage: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
    } as unknown as ConversationService;
    taskService = {
      batchCreate: vi.fn().mockReturnValue([{ id: 't-1' }, { id: 't-2' }]),
    } as unknown as TaskService;

    service = new PlanningService(conversationService, taskService, bus, bus, new MockLogger());
    service.init();
  });

  describe('plan:submitted subscription', () => {
    it('records pending plan when event is emitted', () => {
      const tasks: PlanTaskDraft[] = [{ type: 'task', title: 'A' }];
      emitSubmitted('conv-1', 'org-1', tasks);

      const pending = service.getPendingPlan('conv-1');
      expect(pending).toBeDefined();
      expect(pending?.tasks).toEqual(tasks);
      expect(pending?.orgId).toBe('org-1');
    });

    it('multiple conversations tracked independently', () => {
      emitSubmitted('conv-a', 'org-1', [{ type: 'task', title: 'A' }]);
      emitSubmitted('conv-b', 'org-1', [{ type: 'task', title: 'B' }]);

      expect(service.getPendingPlan('conv-a')?.tasks[0].title).toBe('A');
      expect(service.getPendingPlan('conv-b')?.tasks[0].title).toBe('B');
    });

    it('expires pending plan older than 24h', () => {
      const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      emitSubmitted('conv-old', 'org-1', [{ type: 'task', title: 'Stale' }], oneDayAgo);

      expect(service.getPendingPlan('conv-old')).toBeUndefined();
    });
  });

  describe('confirmPlan', () => {
    it('batch-creates tasks, completes conversation, publishes planning:plan-ready', () => {
      emitSubmitted('conv-1', 'org-1', [{ type: 'task', title: 'A' }]);

      service.confirmPlan('conv-1', 'org-1', null);

      expect(taskService.batchCreate).toHaveBeenCalledWith('org-1', null, [{ type: 'task', title: 'A' }]);
      expect(conversationService.complete).toHaveBeenCalledWith('conv-1');
      bus.assertEmitted('planning:plan-ready');
      const event = bus.getLastEmitted('planning:plan-ready');
      expect(event?.payload).toEqual(expect.objectContaining({
        conversationId: 'conv-1',
        orgId: 'org-1',
        taskCount: 2,
      }));
    });

    it('removes pending plan after confirm', () => {
      emitSubmitted('conv-1', 'org-1', [{ type: 'task', title: 'A' }]);
      service.confirmPlan('conv-1', 'org-1', null);
      expect(service.getPendingPlan('conv-1')).toBeUndefined();
    });

    it('is a no-op when no pending plan exists', () => {
      service.confirmPlan('conv-missing', 'org-1', null);
      expect(taskService.batchCreate).not.toHaveBeenCalled();
      expect(conversationService.complete).not.toHaveBeenCalled();
    });
  });

  describe('discardPlan', () => {
    it('removes pending plan and cancels the conversation', () => {
      emitSubmitted('conv-1', 'org-1', [{ type: 'task', title: 'A' }]);
      service.discardPlan('conv-1');

      expect(service.getPendingPlan('conv-1')).toBeUndefined();
      expect(conversationService.cancel).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('start', () => {
    it('delegates to ConversationService.createPlanningOrAdhoc', () => {
      service.start('org-1', 'role-planner', 'Design a feature');
      expect(conversationService.createPlanningOrAdhoc).toHaveBeenCalledWith(
        'org-1',
        'planning',
        'human',
        'role-planner',
        'Design a feature',
      );
    });
  });
});
