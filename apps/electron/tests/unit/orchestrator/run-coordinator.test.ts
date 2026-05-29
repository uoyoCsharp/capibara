import { describe, it, expect, beforeEach } from 'vitest';
import { RunCoordinator } from '@core/modules/orchestrator/run.coordinator';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { IRunEngine } from '@core/modules/execution/interfaces/i-run-engine';
import type { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { RunResult } from '@core/modules/execution/types/execution.types';
import type { Conversation } from '@core/modules/conversation/types/conversation.types';
import type { ResumeDecision } from '@core/modules/acp/collaboration/suspension.types';

function createRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    runId: 'run-1',
    status: 'succeeded',
    sessionId: 'sess-1',
    summary: 'Done',
    inputTokens: 100,
    outputTokens: 50,
    model: 'sonnet',
    exitCode: 0,
    errorMessage: null,
    ...overrides,
  };
}

function createConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv-1',
    orgId: TEST_ORG_ID,
    type: 'inquiry',
    state: 'waiting',
    initiatorRoleId: 'role-initiator',
    respondentRoleId: TEST_ROLE_ID,
    respondentType: 'ai',
    taskId: TEST_TASK_ID,
    parentConversationId: null,
    depth: 0,
    priority: 0,
    timeoutAt: null,
    externalSessionId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RunCoordinator', () => {
  let coordinator: RunCoordinator;
  let runEngine: IRunEngine;
  let promptBuilder: PromptBuilder;
  let convRepo: IConversationRepository;
  let conversationService: ConversationService;
  let orgRepo: IOrganizationRepository;
  let logger: MockLogger;

  beforeEach(() => {
    runEngine = {
      execute: vi.fn().mockResolvedValue(createRunResult()),
      cancelRun: vi.fn(),
      onLog: vi.fn(),
      onAssistantText: vi.fn(),
    };
    promptBuilder = {
      buildForTask: vi.fn().mockReturnValue('task prompt content'),
      buildForConversation: vi.fn().mockReturnValue('conversation prompt content'),
    } as unknown as PromptBuilder;
    convRepo = {
      findById: vi.fn().mockReturnValue(createConversation()),
      findByOrgId: vi.fn(),
      findByTaskId: vi.fn(),
      findActiveByOrgId: vi.fn(),
      findByState: vi.fn(),
      findTimedOutInquiries: vi.fn(),
      create: vi.fn(),
      updateState: vi.fn(),
      updateRespondent: vi.fn(),
      updateExternalSessionId: vi.fn(),
      delete: vi.fn(),
    };
    conversationService = {
      updateExternalSessionId: vi.fn(),
      addMessage: vi.fn(),
    } as unknown as ConversationService;
    orgRepo = {
      findById: vi.fn().mockReturnValue({ id: TEST_ORG_ID, workspacePath: '/workspace' }),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as IOrganizationRepository;
    logger = new MockLogger();

    coordinator = new RunCoordinator(
      runEngine,
      promptBuilder,
      convRepo,
      conversationService,
      orgRepo,
      logger,
    );
  });

  describe('executeForTask', () => {
    it('builds prompt, executes, and returns result', async () => {
      const result = await coordinator.executeForTask(TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US');
      expect(promptBuilder.buildForTask).toHaveBeenCalledWith(TEST_TASK_ID, TEST_ROLE_ID, 'en-US', 'task_assigned');
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        prompt: 'task prompt content',
        taskId: TEST_TASK_ID,
        wakeReason: 'task_assigned',
        projectDir: '/workspace',
        lifecycleIntent: 'close_on_complete',
      }));
      expect(result).toEqual({ runId: 'run-1', status: 'succeeded' });
    });

    it('returns failed when prompt builder returns null', async () => {
      vi.mocked(promptBuilder.buildForTask).mockReturnValue(null as any);
      const result = await coordinator.executeForTask(TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US');
      expect(result).toEqual({ runId: '', status: 'failed' });
      expect(runEngine.execute).not.toHaveBeenCalled();
    });

    it('uses undefined projectDir when org not found', async () => {
      vi.mocked(orgRepo.findById).mockReturnValue(null);
      await coordinator.executeForTask(TEST_TASK_ID, TEST_ROLE_ID, TEST_ORG_ID, 'task_assigned', 'en-US');
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        projectDir: undefined,
      }));
    });
  });

  describe('executeForConversation', () => {
    it('builds prompt, executes, and saves session id', async () => {
      const result = await coordinator.executeForConversation('conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(promptBuilder.buildForConversation).toHaveBeenCalledWith('conv-1', TEST_ROLE_ID, 'en-US');
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        prompt: 'conversation prompt content',
        conversationId: 'conv-1',
        wakeReason: 'conversation_reply',
        sessionId: undefined,
        lifecycleIntent: 'keep_alive',
      }));
      expect(conversationService.updateExternalSessionId).toHaveBeenCalledWith('conv-1', 'sess-1');
      expect(conversationService.addMessage).toHaveBeenCalledWith('conv-1', {
        conversationId: 'conv-1',
        authorRoleId: TEST_ROLE_ID,
        authorType: 'ai',
        content: 'Done',
        intent: 'reply',
      });
      expect(result).toEqual({ runId: 'run-1', status: 'succeeded' });
    });

    it('does not update session id when conversation already has one', async () => {
      vi.mocked(convRepo.findById).mockReturnValue(createConversation({ externalSessionId: 'existing-sess' }));
      await coordinator.executeForConversation('conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'existing-sess',
      }));
      expect(conversationService.updateExternalSessionId).not.toHaveBeenCalled();
    });

    it('returns failed when conversation not found', async () => {
      vi.mocked(convRepo.findById).mockReturnValue(null);
      const result = await coordinator.executeForConversation('nonexistent', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(result).toEqual({ runId: '', status: 'failed' });
      expect(runEngine.execute).not.toHaveBeenCalled();
    });

    it('returns failed when prompt builder returns null', async () => {
      vi.mocked(promptBuilder.buildForConversation).mockReturnValue(null as any);
      const result = await coordinator.executeForConversation('conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(result).toEqual({ runId: '', status: 'failed' });
      expect(runEngine.execute).not.toHaveBeenCalled();
    });

    it('does not update session when run result has no session id', async () => {
      vi.mocked(runEngine.execute).mockResolvedValue(createRunResult({ sessionId: null }));
      await coordinator.executeForConversation('conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(conversationService.updateExternalSessionId).not.toHaveBeenCalled();
    });

    it('does not add message when run fails', async () => {
      vi.mocked(runEngine.execute).mockResolvedValue(createRunResult({ status: 'failed', summary: null }));
      await coordinator.executeForConversation('conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(conversationService.addMessage).not.toHaveBeenCalled();
    });

    it('does not add message when summary is null', async () => {
      vi.mocked(runEngine.execute).mockResolvedValue(createRunResult({ status: 'succeeded', summary: null }));
      await coordinator.executeForConversation('conv-1', TEST_ROLE_ID, TEST_ORG_ID, 'en-US');
      expect(conversationService.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('executeResume', () => {
    function createDecision(overrides?: Partial<ResumeDecision>): ResumeDecision {
      return {
        suspensionId: 'susp-1',
        sessionId: 'internal-1',
        acpSessionId: 'acp-sess-1',
        runId: 'run-1',
        roleId: TEST_ROLE_ID,
        orgId: TEST_ORG_ID,
        taskId: TEST_TASK_ID,
        aggregatedReply: 'aggregated reply',
        ...overrides,
      };
    }

    it('inherits close_on_complete intent when resuming a task', async () => {
      await coordinator.executeResume(createDecision({ taskId: TEST_TASK_ID }), 'en-US');
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'acp-sess-1',
        taskId: TEST_TASK_ID,
        lifecycleIntent: 'close_on_complete',
      }));
    });

    it('inherits keep_alive intent when resuming a non-task (planning) session', async () => {
      await coordinator.executeResume(createDecision({ taskId: null }), 'en-US');
      expect(runEngine.execute).toHaveBeenCalledWith(expect.objectContaining({
        lifecycleIntent: 'keep_alive',
      }));
    });
  });
});
