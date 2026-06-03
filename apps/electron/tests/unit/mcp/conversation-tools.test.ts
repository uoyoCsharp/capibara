import { describe, it, expect, beforeEach } from 'vitest';
import { registerConversationTools } from '@core/mcp/providers/conversation-tool.provider';
import { MockMcpServer, parseToolResult } from '../../helpers/mock-mcp-server';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';

function createMockSuspensionManager(): ISessionSuspensionManager {
  return {
    suspend: vi.fn(),
    onInquiryResolved: vi.fn().mockReturnValue(null),
    findSuspensionByInquiry: vi.fn().mockReturnValue(null),
    findActiveByRole: vi.fn().mockReturnValue(null),
    findSuspensionAwaitingRole: vi.fn().mockReturnValue(null),
    getChainDepth: vi.fn().mockReturnValue(0),
  };
}

const testConfig: CollaborationConfig = {
  maxChainDepth: 3,
  maxBroadcastTargets: 3,
  maxResumeCount: 10,
  inquiryTimeoutMs: 300_000,
};

describe('Conversation Tools (MCP Handlers)', () => {
  let mockServer: MockMcpServer;
  let conversationService: ConversationService;

  beforeEach(() => {
    conversationService = {
      createInquiry: vi.fn().mockReturnValue({
        id: 'conv-new',
        respondentRoleId: 'role-resp',
        state: 'waiting',
      }),
    } as unknown as ConversationService;

    mockServer = new MockMcpServer();
    registerConversationTools(mockServer as any, { conversationService } as any);
  });

  describe('capibara_ask_question', () => {
    it('creates inquiry via ConversationService', async () => {
      const handler = mockServer.getHandler('capibara_ask_question');
      const raw = await handler(
        { orgId: 'org-1', askingRoleId: 'role-asker', taskId: 'task-1', question: 'How to deploy?' },
      );
      const { data } = parseToolResult(raw);

      expect(conversationService.createInquiry).toHaveBeenCalledWith(
        'org-1', 'role-asker', 'task-1', 'How to deploy?',
        undefined, undefined, undefined,
      );
      expect(data).toEqual({
        conversationId: 'conv-new',
        respondentRoleId: 'role-resp',
        state: 'waiting',
      });
    });

    it('returns correct structure from conversation response', async () => {
      vi.mocked(conversationService.createInquiry).mockReturnValue({
        id: 'conv-2',
        respondentRoleId: null,
        state: 'active',
      } as ReturnType<typeof conversationService.createInquiry>);

      const handler = mockServer.getHandler('capibara_ask_question');
      const raw = await handler(
        { orgId: 'org-1', askingRoleId: 'role-x', taskId: 'task-2', question: 'Why?' },
      );
      const { data } = parseToolResult(raw);
      expect(data).toEqual({
        conversationId: 'conv-2',
        respondentRoleId: null,
        state: 'active',
      });
    });
  });

  describe('capibara_ask_question with chain depth + cycle detection', () => {
    let suspensionManager: ISessionSuspensionManager;

    beforeEach(() => {
      suspensionManager = createMockSuspensionManager();
      mockServer = new MockMcpServer();
      registerConversationTools(mockServer as any, {
        conversationService,
        suspensionManager,
        collaborationConfig: testConfig,
      } as any);
    });

    it('returns error when chain depth limit reached', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(3);
      const handler = mockServer.getHandler('capibara_ask_question');
      const raw = await handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?' },
      );
      const { data, isError } = parseToolResult(raw);

      expect(isError).toBe(true);
      expect((data as any).error).toContain('Chain depth limit reached');
    });

    it('allows when chain depth is below limit', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(2);
      const handler = mockServer.getHandler('capibara_ask_question');
      const raw = await handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?' },
      );
      const { data } = parseToolResult(raw);

      expect((data as any).conversationId).toBe('conv-new');
    });

    it('returns error on circular inquiry (targetRoleId is waiting for asker)', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(0);
      vi.mocked(suspensionManager.findSuspensionAwaitingRole).mockReturnValue({
        id: 'susp-1', roleId: 'role-b',
      } as any);

      const handler = mockServer.getHandler('capibara_ask_question');
      const raw = await handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?', targetRoleId: 'role-b' },
      );
      const { data, isError } = parseToolResult(raw);

      expect(isError).toBe(true);
      expect((data as any).error).toContain('Circular inquiry detected');
    });

    it('passes targetRoleId to createInquiry', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(0);

      const handler = mockServer.getHandler('capibara_ask_question');
      await handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?', targetRoleId: 'role-target' },
      );

      expect(conversationService.createInquiry).toHaveBeenCalledWith(
        'org-1', 'role-a', 'task-1', 'Q?',
        undefined, undefined, 'role-target',
      );
    });
  });

  describe('capibara_broadcast_question', () => {
    let suspensionManager: ISessionSuspensionManager;

    beforeEach(() => {
      suspensionManager = createMockSuspensionManager();
      mockServer = new MockMcpServer();
      registerConversationTools(mockServer as any, {
        conversationService,
        suspensionManager,
        collaborationConfig: testConfig,
      } as any);
    });

    it('creates inquiry for each target role', async () => {
      const handler = mockServer.getHandler('capibara_broadcast_question');
      const raw = await handler({
        orgId: 'org-1',
        askingRoleId: 'role-a',
        taskId: 'task-1',
        targetRoleIds: ['role-b', 'role-c'],
        question: 'What do you think?',
      });
      const { data } = parseToolResult(raw);
      const result = data as any;

      expect(conversationService.createInquiry).toHaveBeenCalledTimes(2);
      expect(result.inquiries).toHaveLength(2);
      expect(result.waitMode).toBe('all');
    });

    it('returns error when targets exceed max', async () => {
      const handler = mockServer.getHandler('capibara_broadcast_question');
      const raw = await handler({
        orgId: 'org-1',
        askingRoleId: 'role-a',
        taskId: 'task-1',
        targetRoleIds: ['r1', 'r2', 'r3', 'r4'],
        question: 'Q?',
      });
      const { data, isError } = parseToolResult(raw);

      expect(isError).toBe(true);
      expect((data as any).error).toContain('Too many targets');
    });

    it('returns error when no targets provided', async () => {
      const handler = mockServer.getHandler('capibara_broadcast_question');
      const raw = await handler({
        orgId: 'org-1',
        askingRoleId: 'role-a',
        taskId: 'task-1',
        targetRoleIds: [],
        question: 'Q?',
      });
      const { data, isError } = parseToolResult(raw);

      expect(isError).toBe(true);
      expect((data as any).error).toContain('At least one target');
    });

    it('returns error when chain depth limit reached', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(3);
      const handler = mockServer.getHandler('capibara_broadcast_question');
      const raw = await handler({
        orgId: 'org-1',
        askingRoleId: 'role-a',
        taskId: 'task-1',
        targetRoleIds: ['role-b'],
        question: 'Q?',
      });
      const { data, isError } = parseToolResult(raw);

      expect(isError).toBe(true);
      expect((data as any).error).toContain('Chain depth limit reached');
    });

    it('detects circular inquiry in broadcast targets', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(0);
      vi.mocked(suspensionManager.findSuspensionAwaitingRole).mockReturnValue({
        id: 'susp-1', roleId: 'role-c',
      } as any);

      const handler = mockServer.getHandler('capibara_broadcast_question');
      const raw = await handler({
        orgId: 'org-1',
        askingRoleId: 'role-a',
        taskId: 'task-1',
        targetRoleIds: ['role-b', 'role-c'],
        question: 'Q?',
      });
      const { data, isError } = parseToolResult(raw);

      expect(isError).toBe(true);
      expect((data as any).error).toContain('Circular inquiry detected');
      expect((data as any).error).toContain('role-c');
    });

    it('uses custom waitMode', async () => {
      const handler = mockServer.getHandler('capibara_broadcast_question');
      const raw = await handler({
        orgId: 'org-1',
        askingRoleId: 'role-a',
        taskId: 'task-1',
        targetRoleIds: ['role-b'],
        question: 'Q?',
        waitMode: 'any',
      });
      const { data } = parseToolResult(raw);

      expect((data as any).waitMode).toBe('any');
    });
  });
});
