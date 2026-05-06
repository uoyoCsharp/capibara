import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanningService } from '@core/modules/planning/planning.service';
import type { IPendingPlanTreeRepository } from '@core/modules/planning/interfaces/i-pending-plan-tree.repository';
import type { PendingPlanTree } from '@core/modules/planning/types/pending-plan-tree.types';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { PlanTreeNode } from '@core/foundation/events';

const SAMPLE_TREE: PlanTreeNode = {
  type: 'epic', title: 'Root', description: 'Root epic', assigneeRoleId: 'role-cto',
  children: [
    { type: 'story', title: 'S1', description: 'Story 1', assigneeRoleId: 'role-dev', children: [] },
  ],
};

function makePendingTree(overrides: Partial<PendingPlanTree> = {}): PendingPlanTree {
  return {
    id: 'pt-1',
    rootTaskId: 'task-root',
    sourceConversationId: null,
    orgId: 'org-1',
    roleId: 'role-cto',
    mode: 'preview',
    tree: SAMPLE_TREE,
    version: 1,
    status: 'active',
    pendingFeedback: null,
    conversationId: 'conv-review-1',
    submittedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    reviewedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PlanningService (persistent)', () => {
  let bus: MockEventBus;
  let service: PlanningService;
  let repo: Record<keyof IPendingPlanTreeRepository, ReturnType<typeof vi.fn>>;
  let conversationService: Record<string, ReturnType<typeof vi.fn>>;
  let taskService: Record<string, ReturnType<typeof vi.fn>>;
  let taskStateMachine: Record<string, ReturnType<typeof vi.fn>>;
  let processEngine: Record<string, ReturnType<typeof vi.fn>>;
  let connection: ISqliteConnection;

  beforeEach(() => {
    bus = new MockEventBus();

    repo = {
      findById: vi.fn(),
      findActiveByRootTaskId: vi.fn().mockReturnValue(null),
      findActiveBySourceConversationId: vi.fn().mockReturnValue(null),
      findByOrgId: vi.fn().mockReturnValue([]),
      findExpired: vi.fn().mockReturnValue([]),
      upsert: vi.fn().mockImplementation((input) => makePendingTree({
        rootTaskId: input.rootTaskId ?? null,
        sourceConversationId: input.sourceConversationId ?? null,
      })),
      updateStatus: vi.fn(),
      updateFeedback: vi.fn(),
      updateConversationId: vi.fn(),
      delete: vi.fn(),
    };

    conversationService = {
      findById: vi.fn().mockReturnValue({ id: 'conv-review-1', state: 'active' }),
      createPlanReview: vi.fn().mockReturnValue({ id: 'conv-review-1' }),
      addMessage: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
    };

    taskService = {
      findById: vi.fn().mockReturnValue({
        id: 'task-root', orgId: 'org-1', status: 'in_progress', assigneeRoleId: 'role-cto',
      }),
      batchCreate: vi.fn().mockReturnValue([{ id: 't-1' }, { id: 't-2' }]),
    };

    taskStateMachine = {
      transition: vi.fn(),
    };

    processEngine = {
      getAvailableTransitions: vi.fn().mockReturnValue([{ from: 'pending', to: 'in_progress' }]),
    };

    const txnFn = vi.fn().mockImplementation((fn: () => unknown) => fn);
    connection = {
      getDb: () => ({
        transaction: txnFn,
      }),
      close: vi.fn(),
    } as unknown as ISqliteConnection;

    service = new PlanningService(
      taskService as unknown as TaskService,
      taskStateMachine as unknown as TaskStateMachine,
      processEngine as unknown as ProcessEngine,
      connection,
      bus, bus, new MockLogger(),
      repo as unknown as IPendingPlanTreeRepository,
      conversationService as unknown as ConversationService,
    );
    service.init();
  });

  // ── onTreeSubmitted (preview) ──

  describe('onTreeSubmitted (preview)', () => {
    it('PS-01: first preview submit persists active record with version=1', () => {
      bus.publish('plan-tree:submitted', {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      });
      expect(repo.upsert).toHaveBeenCalledTimes(1);
    });

    it('PS-02: second submit for same rootTaskId calls upsert again', () => {
      const payload = {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview' as const, tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      };
      bus.publish('plan-tree:submitted', payload);
      // Simulate repo returning existing tree with conversationId
      repo.upsert.mockReturnValue(makePendingTree({ version: 2, conversationId: 'conv-review-1' }));
      bus.publish('plan-tree:submitted', payload);
      expect(repo.upsert).toHaveBeenCalledTimes(2);
    });

    it('PS-03: first submit creates plan_review conversation', () => {
      repo.upsert.mockReturnValue(makePendingTree({ conversationId: null }));
      bus.publish('plan-tree:submitted', {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      });
      expect(conversationService.createPlanReview).toHaveBeenCalledWith(
        'org-1', 'role-cto', 'task-root', 'pt-1', 1,
      );
    });

    it('PS-04: second submit adds system message to existing conversation', () => {
      // First submit has conversationId
      repo.upsert.mockReturnValue(makePendingTree({ conversationId: 'conv-review-1', version: 2 }));
      conversationService.findById.mockReturnValue({ id: 'conv-review-1', state: 'active' });

      bus.publish('plan-tree:submitted', {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      });

      expect(conversationService.addMessage).toHaveBeenCalledWith(
        'conv-review-1',
        expect.objectContaining({
          authorType: 'system',
          content: expect.stringContaining('version 2'),
        }),
      );
    });

    it('PS-05: publishes plan-tree:ready event', () => {
      bus.publish('plan-tree:submitted', {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      });
      bus.assertEmitted('plan-tree:ready');
    });
  });

  // ── onTreeSubmitted (eager) ──

  describe('onTreeSubmitted (eager)', () => {
    it('PS-06: eager mode calls applyTree directly, no plan_review', () => {
      bus.publish('plan-tree:submitted', {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'eager', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      });
      expect(taskService.batchCreate).toHaveBeenCalled();
      expect(conversationService.createPlanReview).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('PS-07: eager applyTree failure publishes plan-tree:discarded', () => {
      taskService.batchCreate.mockImplementation(() => { throw new Error('DB error'); });
      bus.publish('plan-tree:submitted', {
        rootTaskId: 'task-root', sourceConversationId: null, orgId: 'org-1', roleId: 'role-cto',
        mode: 'eager', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      });
      bus.assertEmitted('plan-tree:discarded');
    });
  });

  // ── approvePlanTree ──

  describe('approvePlanTree', () => {
    it('PS-08: approve updates status, creates children, completes conversation', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      const result = service.approvePlanTree('task-root');
      expect(result.ok).toBe(true);
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'approved', expect.any(String));
      expect(taskService.batchCreate).toHaveBeenCalled();
      expect(conversationService.complete).toHaveBeenCalledWith('conv-review-1');
    });

    it('PS-09: no pending tree returns NO_PENDING_TREE', () => {
      repo.findActiveByRootTaskId.mockReturnValue(null);
      const result = service.approvePlanTree('task-root');
      expect(result).toEqual({ ok: false, code: 'NO_PENDING_TREE', message: expect.any(String) });
    });

    it('PS-10: version mismatch returns VERSION_MISMATCH', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree({ version: 3 }));
      const result = service.approvePlanTree('task-root', 2);
      expect(result.code).toBe('VERSION_MISMATCH');
    });

    it('PS-11: applyTree failure returns APPLY_FAILED without status change', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      taskService.batchCreate.mockImplementation(() => { throw new Error('tx fail'); });
      const result = service.approvePlanTree('task-root');
      expect(result.code).toBe('APPLY_FAILED');
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it('PS-12: advances pending root task to in_progress after decomposition', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      taskService.findById.mockReturnValue({
        id: 'task-root', orgId: 'org-1', status: 'pending', assigneeRoleId: 'role-cto',
      });
      service.approvePlanTree('task-root');
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-root', 'in_progress');
    });

    it('PS-12a: does NOT advance root when it is already in_progress (no-op)', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      taskService.findById.mockReturnValue({
        id: 'task-root', orgId: 'org-1', status: 'in_progress', assigneeRoleId: 'role-cto',
      });
      service.approvePlanTree('task-root');
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('PS-12b: does NOT advance root when no pending→in_progress transition is available', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      taskService.findById.mockReturnValue({
        id: 'task-root', orgId: 'org-1', status: 'awaiting_review', assigneeRoleId: 'role-cto',
      });
      processEngine.getAvailableTransitions.mockReturnValue([
        { from: 'awaiting_review', to: 'done' },
        { from: 'awaiting_review', to: 'revision' },
      ]);
      service.approvePlanTree('task-root');
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('PS-13: publishes plan-tree:approved event', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      service.approvePlanTree('task-root');
      bus.assertEmitted('plan-tree:approved');
    });
  });

  // ── discardPlanTree ──

  describe('discardPlanTree', () => {
    it('PS-14: discard updates status and cancels conversation', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      const result = service.discardPlanTree('task-root', 'not needed');
      expect(result.ok).toBe(true);
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'discarded', expect.any(String));
      expect(conversationService.cancel).toHaveBeenCalledWith('conv-review-1');
    });

    it('PS-15: root task not found returns ROOT_TASK_NOT_FOUND', () => {
      taskService.findById.mockReturnValue(null);
      const result = service.discardPlanTree('task-missing', null);
      expect(result.code).toBe('ROOT_TASK_NOT_FOUND');
    });

    it('PS-16: attempts to revert root to pending', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      service.discardPlanTree('task-root', null);
      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-root', 'pending');
    });

    it('PS-17: publishes plan-tree:discarded event', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      service.discardPlanTree('task-root', 'reason');
      bus.assertEmitted('plan-tree:discarded');
    });
  });

  // ── refinePlanTree ──

  describe('refinePlanTree', () => {
    beforeEach(() => {
      service.setWaker({
        tryWake: vi.fn(),
      });
    });

    it('PS-18: writes feedback, sets refining, wakes AI', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      const result = service.refinePlanTree('task-root', 'Add more stories');
      expect(result.ok).toBe(true);
      expect(repo.updateFeedback).toHaveBeenCalledWith('pt-1', 'Add more stories');
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'refining');
    });

    it('PS-19: empty feedback returns EMPTY_FEEDBACK', () => {
      const result = service.refinePlanTree('task-root', '  ');
      expect(result.code).toBe('EMPTY_FEEDBACK');
    });

    it('PS-20: no pending tree returns NO_PENDING_TREE', () => {
      repo.findActiveByRootTaskId.mockReturnValue(null);
      const result = service.refinePlanTree('task-root', 'feedback');
      expect(result.code).toBe('NO_PENDING_TREE');
    });

    it('PS-21: no waker returns INTERNAL', () => {
      service = new PlanningService(
        taskService as unknown as TaskService,
        taskStateMachine as unknown as TaskStateMachine,
        processEngine as unknown as ProcessEngine,
        connection, bus, bus, new MockLogger(),
        repo as unknown as IPendingPlanTreeRepository,
        conversationService as unknown as ConversationService,
      );
      service.init();
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      const result = service.refinePlanTree('task-root', 'feedback');
      expect(result.code).toBe('INTERNAL');
    });

    it('PS-22: no assignee returns NO_ASSIGNEE', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      taskService.findById.mockReturnValue({ id: 'task-root', orgId: 'org-1', assigneeRoleId: null });
      const result = service.refinePlanTree('task-root', 'feedback');
      expect(result.code).toBe('NO_ASSIGNEE');
    });

    it('PS-23: adds human message to plan_review conversation', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree());
      service.refinePlanTree('task-root', 'More detail please');
      expect(conversationService.addMessage).toHaveBeenCalledWith(
        'conv-review-1',
        expect.objectContaining({
          authorType: 'human',
          content: 'More detail please',
        }),
      );
    });
  });

  // ── consumePendingFeedback ──

  describe('consumePendingFeedback', () => {
    it('PS-24: returns feedback and clears it', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree({ pendingFeedback: 'fix it' }));
      const fb = service.consumePendingFeedback('task-root');
      expect(fb).toBe('fix it');
      expect(repo.updateFeedback).toHaveBeenCalledWith('pt-1', null);
    });

    it('PS-25: returns null when no feedback', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree({ pendingFeedback: null }));
      expect(service.consumePendingFeedback('task-root')).toBeNull();
    });

    it('PS-26: returns null when no pending tree', () => {
      repo.findActiveByRootTaskId.mockReturnValue(null);
      expect(service.consumePendingFeedback('task-root')).toBeNull();
    });
  });

  // ── expireStale ──

  describe('expireStale', () => {
    it('PS-27: marks expired active records as expired', () => {
      const expiredTree = makePendingTree({ id: 'pt-expired', conversationId: 'conv-expired' });
      repo.findExpired.mockReturnValue([expiredTree]);
      service.expireStale();
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-expired', 'expired', expect.any(String));
    });

    it('PS-28: cancels associated conversations', () => {
      repo.findExpired.mockReturnValue([makePendingTree({ conversationId: 'conv-expired' })]);
      service.expireStale();
      expect(conversationService.cancel).toHaveBeenCalledWith('conv-expired');
    });

    it('PS-29: publishes plan-tree:discarded with ttl_expired reason', () => {
      repo.findExpired.mockReturnValue([makePendingTree()]);
      service.expireStale();
      const event = bus.getLastEmitted('plan-tree:discarded');
      expect(event?.payload).toEqual(expect.objectContaining({ reason: 'ttl_expired' }));
    });

    it('PS-30: refining status records are also cleaned', () => {
      const refiningTree = makePendingTree({ status: 'refining' });
      repo.findExpired.mockReturnValue([refiningTree]);
      service.expireStale();
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'expired', expect.any(String));
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    beforeEach(() => {
      service.setWaker({ tryWake: vi.fn() });
    });

    it('PS-E1: approve after version mismatch is rejected', () => {
      repo.findActiveByRootTaskId.mockReturnValue(makePendingTree({ version: 2 }));
      const result = service.approvePlanTree('task-root', 1);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('VERSION_MISMATCH');
    });

    it('PS-E2: approve after approve returns NO_PENDING_TREE', () => {
      repo.findActiveByRootTaskId.mockReturnValueOnce(makePendingTree()).mockReturnValue(null);
      service.approvePlanTree('task-root');
      const result = service.approvePlanTree('task-root');
      expect(result.code).toBe('NO_PENDING_TREE');
    });

    it('PS-E3: discard after approve returns ok (no-op on pending)', () => {
      repo.findActiveByRootTaskId.mockReturnValue(null);
      const result = service.discardPlanTree('task-root', null);
      expect(result.ok).toBe(true);
    });

    it('PS-E5: multiple rootTaskIds are independent', () => {
      const pt1 = makePendingTree({ rootTaskId: 'task-1', version: 1 });
      const pt2 = makePendingTree({ id: 'pt-2', rootTaskId: 'task-2', version: 3 });

      repo.findActiveByRootTaskId
        .mockImplementation((id: string) => id === 'task-1' ? pt1 : id === 'task-2' ? pt2 : null);

      expect(service.getPendingTree('task-1')?.version).toBe(1);
      expect(service.getPendingTree('task-2')?.version).toBe(3);
    });
  });

  // ── Conversational Planning (conversation-anchored flow) ──

  describe('conversation-anchored flow', () => {
    // Helper: build a conversation-anchored pending tree fixture.
    function makeConvPending(overrides: Partial<PendingPlanTree> = {}): PendingPlanTree {
      return makePendingTree({
        rootTaskId: null,
        sourceConversationId: 'conv-plan-1',
        conversationId: null, // no plan_review conversation for this flow
        ...overrides,
      });
    }

    it('PS-CA-01: onTreeSubmitted with sourceConversationId persists via upsert and emits plan-tree:ready', () => {
      repo.upsert.mockReturnValue(makeConvPending({ version: 1 }));
      bus.publish('plan-tree:submitted', {
        rootTaskId: null,
        sourceConversationId: 'conv-plan-1',
        orgId: 'org-1',
        roleId: 'role-pm',
        mode: 'preview',
        tree: SAMPLE_TREE,
        submittedAt: new Date().toISOString(),
      });

      expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({
        sourceConversationId: 'conv-plan-1',
      }));
      // MUST NOT create a plan_review conversation — the planning conversation IS the review channel
      expect(conversationService.createPlanReview).not.toHaveBeenCalled();
      bus.assertEmitted('plan-tree:ready');
    });

    it('PS-CA-02: approvePlanTreeByConversation creates root tasks (parentId=null)', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());

      const result = service.approvePlanTreeByConversation('conv-plan-1');

      expect(result.ok).toBe(true);
      // Root tasks are created under parentId=null — no virtual parent
      expect(taskService.batchCreate).toHaveBeenCalledWith(
        'org-1',
        null,
        expect.any(Array),
      );
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'approved', expect.any(String));
    });

    it('PS-CA-03: approve resolves the source planning conversation', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());
      conversationService.resolve = vi.fn();

      service.approvePlanTreeByConversation('conv-plan-1');

      expect(conversationService.resolve).toHaveBeenCalledWith('conv-plan-1');
    });

    it('PS-CA-04: approve emits plan-tree:approved with sourceConversationId', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());
      conversationService.resolve = vi.fn();

      service.approvePlanTreeByConversation('conv-plan-1');

      const events = bus.getEmitted('plan-tree:approved');
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        rootTaskId: null,
        sourceConversationId: 'conv-plan-1',
        orgId: 'org-1',
      });
    });

    it('PS-CA-05: approve does NOT advance a root task (no task exists for conv-anchored trees)', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());
      conversationService.resolve = vi.fn();

      service.approvePlanTreeByConversation('conv-plan-1');

      // advanceRootAfterDecomposition is only called for task-anchored trees
      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('PS-CA-06: approve failure leaves tree active and conversation unresolved', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());
      taskService.batchCreate.mockImplementation(() => { throw new Error('tx fail'); });
      conversationService.resolve = vi.fn();

      const result = service.approvePlanTreeByConversation('conv-plan-1');

      expect(result.code).toBe('APPLY_FAILED');
      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(conversationService.resolve).not.toHaveBeenCalled();
    });

    it('PS-CA-07: approve with no pending tree returns NO_PENDING_TREE', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(null);

      const result = service.approvePlanTreeByConversation('conv-missing');

      expect(result.code).toBe('NO_PENDING_TREE');
      expect(taskService.batchCreate).not.toHaveBeenCalled();
    });

    it('PS-CA-08: discardPlanTreeByConversation marks tree discarded and emits event', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());

      const result = service.discardPlanTreeByConversation('conv-plan-1', 'user-changed-mind');

      expect(result.ok).toBe(true);
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'discarded', expect.any(String));
      const events = bus.getEmitted('plan-tree:discarded');
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        rootTaskId: null,
        sourceConversationId: 'conv-plan-1',
        reason: 'user-changed-mind',
      });
    });

    it('PS-CA-09: refinePlanTreeByConversation stores feedback and wakes agent role (not a task)', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending({ roleId: 'role-pm' }));
      const tryWake = vi.fn();
      service.setWaker({ tryWake });

      const result = service.refinePlanTreeByConversation('conv-plan-1', 'split the sync story');

      expect(result.ok).toBe(true);
      expect(repo.updateFeedback).toHaveBeenCalledWith('pt-1', 'split the sync story');
      expect(repo.updateStatus).toHaveBeenCalledWith('pt-1', 'refining');
      // Wake targets the agent role with no task anchor
      expect(tryWake).toHaveBeenCalledWith('role-pm', 'org-1', 'conversation_reply', null);
    });

    it('PS-CA-10: refine posts feedback message into the planning conversation itself', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(makeConvPending());
      service.setWaker({ tryWake: vi.fn() });

      service.refinePlanTreeByConversation('conv-plan-1', 'more detail on auth');

      expect(conversationService.addMessage).toHaveBeenCalledWith(
        'conv-plan-1',
        expect.objectContaining({
          authorType: 'human',
          content: 'more detail on auth',
        }),
      );
    });

    it('PS-CA-11: refine with empty feedback returns EMPTY_FEEDBACK without hitting the repo', () => {
      const result = service.refinePlanTreeByConversation('conv-plan-1', '   ');
      expect(result.code).toBe('EMPTY_FEEDBACK');
      expect(repo.findActiveBySourceConversationId).not.toHaveBeenCalled();
    });

    it('PS-CA-12: consumePendingFeedbackByConversation returns and clears feedback once', () => {
      repo.findActiveBySourceConversationId.mockReturnValue(
        makeConvPending({ pendingFeedback: 'iterate on auth module' }),
      );

      const fb = service.consumePendingFeedbackByConversation('conv-plan-1');

      expect(fb).toBe('iterate on auth module');
      expect(repo.updateFeedback).toHaveBeenCalledWith('pt-1', null);
    });
  });
});
