/**
 * TaskRunCoordinator Unit Tests
 *
 * Covers: executeForTask lifecycle, task state transitions, conversation
 * workflow resume, session resume, planning context, post-run Phase 1
 * advancement, conversation awareness, and cleanup.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('tsyringe', () => ({
  injectable: () => (target: any) => target,
  inject: () => () => undefined,
}));

vi.mock('@main/core/tokens.js', () => ({
  LOGGER_TOKEN: Symbol('LOGGER_TOKEN'),
  EVENT_BUS_TOKEN: Symbol('EVENT_BUS_TOKEN'),
  ROLE_REPO_TOKEN: Symbol('ROLE_REPO_TOKEN'),
  TASK_REPO_TOKEN: Symbol('TASK_REPO_TOKEN'),
  RUN_REPO_TOKEN: Symbol('RUN_REPO_TOKEN'),
  ORGANIZATION_REPO_TOKEN: Symbol('ORGANIZATION_REPO_TOKEN'),
  PROMPT_BUILDER_TOKEN: Symbol('PROMPT_BUILDER_TOKEN'),
  RUN_ENGINE_TOKEN: Symbol('RUN_ENGINE_TOKEN'),
  SETTINGS_REPO_TOKEN: Symbol('SETTINGS_REPO_TOKEN'),
}));

import { TaskRunCoordinator } from '@main/application/execution/task-run.coordinator.js';
import type { WakeTrigger, Run } from '@main/core/types/domain.types.js';

// ─── Mock Factories ─────────────────────────────────────────

function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1', orgId: 'org-1', taskNodeId: 'task-1', roleId: 'role-1', status: 'succeeded',
    trigger: 'task_assigned', startedAt: null, finishedAt: null, tokenCount: 1500,
    sessionId: 'sess-1', createdAt: '',
    ...overrides,
  };
}

function createCoordinator() {
  const runEngine = {
    execute: vi.fn().mockResolvedValue({
      runId: 'run-1', status: 'succeeded', sessionId: 'sess-1', summary: 'Done',
      inputTokens: 1000, outputTokens: 500, model: 'opus', exitCode: 0, errorMessage: null,
    }),
    onAssistantText: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  const roleRepo = { findById: vi.fn().mockResolvedValue({ id: 'role-1', requiresHumanApproval: false, status: 'active' }) };
  const taskRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'task-1', orgId: 'org-1', status: 'open', assigneeRoleId: 'role-1' }),
    findByParentId: vi.fn().mockResolvedValue([]),
  };
  const runRepo = {
    findById: vi.fn().mockResolvedValue(createRun()),
    findLastSessionId: vi.fn().mockResolvedValue(null),
  };
  const orgRepo = { findById: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org' }) };
  const promptBuilder = { build: vi.fn().mockReturnValue('system prompt') };
  const settingsRepo = { get: vi.fn().mockResolvedValue(null) };
  const executionContext = { buildPromptContext: vi.fn().mockResolvedValue({}) };
  const taskStateMachine = { transition: vi.fn().mockResolvedValue(undefined) };
  const taskService = { updateStatus: vi.fn().mockResolvedValue(undefined) };

  const workflowEngine = {
    isTerminalStatus: vi.fn().mockResolvedValue(false),
    isReviewStatus: vi.fn().mockResolvedValue(false),
    isActiveStatus: vi.fn().mockResolvedValue(false),
    getAllStatuses: vi.fn().mockResolvedValue([{ name: 'in_progress', category: 'active' }]),
    getFirstReviewStatus: vi.fn().mockResolvedValue('in_review'),
  };

  const coordinator = new (TaskRunCoordinator as any)(
    runEngine, logger, eventBus, roleRepo, taskRepo, runRepo,
    orgRepo, promptBuilder, settingsRepo, executionContext,
    taskStateMachine, taskService,
  );
  coordinator.setWorkflowEngine(workflowEngine);

  return {
    coordinator: coordinator as TaskRunCoordinator,
    runEngine, logger, eventBus, roleRepo, taskRepo, runRepo,
    orgRepo, promptBuilder, settingsRepo, executionContext,
    taskStateMachine, taskService, workflowEngine,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('TaskRunCoordinator', () => {

  describe('executeForTask — basic lifecycle', () => {
    it('should transition task to active, build prompt, execute, and return run', async () => {
      const { coordinator, taskStateMachine, promptBuilder, runEngine, runRepo } = createCoordinator();

      const run = await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskStateMachine.transition).toHaveBeenCalledWith('task-1', 'in_progress');
      expect(promptBuilder.build).toHaveBeenCalled();
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        roleId: 'role-1', orgId: 'org-1', prompt: 'system prompt',
        taskNodeId: 'task-1', mcpContext: 'task:execution',
      }));
      expect(runRepo.findById).toHaveBeenCalledWith('run-1');
      expect(run).toBeDefined();
    });

    it('should not transition task when already in terminal status', async () => {
      const { coordinator, taskStateMachine, workflowEngine } = createCoordinator();
      (workflowEngine.isTerminalStatus as any).mockResolvedValue(true);

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('should not transition task when in review status', async () => {
      const { coordinator, taskStateMachine, workflowEngine } = createCoordinator();
      (workflowEngine.isReviewStatus as any).mockResolvedValue(true);

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskStateMachine.transition).not.toHaveBeenCalled();
    });

    it('should swallow transition errors', async () => {
      const { coordinator, taskStateMachine } = createCoordinator();
      (taskStateMachine.transition as any).mockRejectedValue(new Error('Already in status'));

      const run = await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(run).toBeDefined();
    });
  });

  describe('session resume', () => {
    it('should not resume session for review_approve trigger', async () => {
      const { coordinator, runEngine, runRepo } = createCoordinator();
      (runRepo.findLastSessionId as any).mockResolvedValue('old-session');

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'review_approve');

      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: undefined,
      }));
    });

    it('should resume session for normal triggers', async () => {
      const { coordinator, runEngine, runRepo } = createCoordinator();
      (runRepo.findLastSessionId as any).mockResolvedValue('old-session');

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'old-session',
      }));
    });
  });

  describe('conversation workflow resume', () => {
    it('should transition conversation workflow to resumed on discussion_reply', async () => {
      const { coordinator } = createCoordinator();
      const conversationWorkflowRepo = {
        findActiveByRoleAndTask: vi.fn().mockResolvedValue({ id: 'wf-1', state: 'reply_received', askingSessionId: 'sess-old' }),
        updateState: vi.fn().mockResolvedValue(undefined),
      };
      coordinator.setConversationWorkflowRepo(conversationWorkflowRepo as any);

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'discussion_reply');

      expect(conversationWorkflowRepo.updateState).toHaveBeenCalledWith('wf-1', 'resumed');
    });

    it('should use conversation askingSessionId for discussion_reply', async () => {
      const { coordinator, runEngine } = createCoordinator();
      const conversationWorkflowRepo = {
        findActiveByRoleAndTask: vi.fn().mockResolvedValue({ id: 'wf-1', state: 'reply_received', askingSessionId: 'convo-session' }),
        updateState: vi.fn().mockResolvedValue(undefined),
      };
      coordinator.setConversationWorkflowRepo(conversationWorkflowRepo as any);

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'discussion_reply');

      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'convo-session',
      }));
    });
  });

  describe('Phase 1 advancement', () => {
    it('should advance to review when role requires human approval and task is active', async () => {
      const { coordinator, taskRepo, roleRepo, workflowEngine, taskService } = createCoordinator();
      (taskRepo.findById as any).mockResolvedValue({ id: 'task-1', orgId: 'org-1', status: 'in_progress' });
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue({ id: 'role-1', requiresHumanApproval: true });

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskService.updateStatus).toHaveBeenCalledWith('task-1', 'in_review');
    });

    it('should NOT advance when role does not require human approval', async () => {
      const { coordinator, taskRepo, workflowEngine, taskService } = createCoordinator();
      (taskRepo.findById as any).mockResolvedValue({ id: 'task-1', orgId: 'org-1', status: 'in_progress' });
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should NOT advance when task is not in active status', async () => {
      const { coordinator, taskRepo, roleRepo, workflowEngine, taskService } = createCoordinator();
      (taskRepo.findById as any).mockResolvedValue({ id: 'task-1', orgId: 'org-1', status: 'done' });
      (workflowEngine.isActiveStatus as any).mockResolvedValue(false);
      (roleRepo.findById as any).mockResolvedValue({ id: 'role-1', requiresHumanApproval: true });

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should NOT advance when active conversation exists', async () => {
      const { coordinator, taskRepo, roleRepo, workflowEngine, taskService } = createCoordinator();
      (taskRepo.findById as any).mockResolvedValue({ id: 'task-1', orgId: 'org-1', status: 'in_progress' });
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue({ id: 'role-1', requiresHumanApproval: true });

      const conversationWorkflowRepo = {
        findActiveByRoleAndTask: vi.fn().mockResolvedValue({ id: 'wf-1', state: 'waiting_for_reply' }),
        updateState: vi.fn(),
      };
      coordinator.setConversationWorkflowRepo(conversationWorkflowRepo as any);

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(taskService.updateStatus).not.toHaveBeenCalled();
    });

    it('should swallow advancement transition errors', async () => {
      const { coordinator, taskRepo, roleRepo, workflowEngine, taskService } = createCoordinator();
      (taskRepo.findById as any).mockResolvedValue({ id: 'task-1', orgId: 'org-1', status: 'in_progress' });
      (workflowEngine.isActiveStatus as any).mockResolvedValue(true);
      (roleRepo.findById as any).mockResolvedValue({ id: 'role-1', requiresHumanApproval: true });
      (taskService.updateStatus as any).mockRejectedValue(new Error('Transition not allowed'));

      const run = await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned');

      expect(run).toBeDefined();
    });
  });

  describe('planning context', () => {
    it('should pass planning context through to prompt builder', async () => {
      const { coordinator, executionContext } = createCoordinator();
      const planCtx = { orgRoles: [{ id: 'r1', name: 'Dev', skillDescriptions: [] }] };

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned', planCtx);

      expect(executionContext.buildPromptContext).toHaveBeenCalledWith('role-1', 'task-1', 'task_assigned', planCtx);
    });

    it('should load locale into planning context', async () => {
      const { coordinator, settingsRepo, executionContext } = createCoordinator();
      (settingsRepo.get as any).mockResolvedValue('zh-CN');
      const planCtx = { orgRoles: [] };

      await coordinator.executeForTask('role-1', 'task-1', 'org-1', 'task_assigned', planCtx);

      expect(executionContext.buildPromptContext).toHaveBeenCalledWith(
        'role-1', 'task-1', 'task_assigned',
        expect.objectContaining({ communicationLanguage: 'zh-CN' }),
      );
    });
  });
});
