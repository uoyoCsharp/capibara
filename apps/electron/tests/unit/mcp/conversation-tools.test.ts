import { describe, it, expect, beforeEach } from 'vitest';
import { createConversationTools } from '@core/modules/mcp/handlers/conversation-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
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
  let tools: McpToolDefinition[];
  let conversationService: ConversationService;

  beforeEach(() => {
    conversationService = {
      createInquiry: vi.fn().mockReturnValue({
        id: 'conv-new',
        respondentRoleId: 'role-resp',
        state: 'waiting',
      }),
    } as unknown as ConversationService;

    tools = createConversationTools(conversationService);
  });

  function findTool(name: string): McpToolDefinition {
    return tools.find((t) => t.name === name)!;
  }

  describe('capibara_ask_question', () => {
    it('creates inquiry via ConversationService', async () => {
      const tool = findTool('capibara_ask_question');
      const result = await tool.handler(
        { orgId: 'org-1', askingRoleId: 'role-asker', taskId: 'task-1', question: 'How to deploy?' },
        'run-1',
      );

      expect(conversationService.createInquiry).toHaveBeenCalledWith(
        'org-1', 'role-asker', 'task-1', 'How to deploy?',
        undefined, undefined, undefined,
      );
      expect(result).toEqual({
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

      const tool = findTool('capibara_ask_question');
      const result = await tool.handler(
        { orgId: 'org-1', askingRoleId: 'role-x', taskId: 'task-2', question: 'Why?' },
        'run-2',
      );
      expect(result).toEqual({
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
      tools = createConversationTools(conversationService, suspensionManager, testConfig);
    });

    it('returns error when chain depth limit reached', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(3);
      const tool = findTool('capibara_ask_question');
      const result = await tool.handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?' },
        'run-1',
      ) as any;

      expect(result.error).toContain('Chain depth limit reached');
    });

    it('allows when chain depth is below limit', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(2);
      const tool = findTool('capibara_ask_question');
      const result = await tool.handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?' },
        'run-1',
      ) as any;

      expect(result.conversationId).toBe('conv-new');
    });

    it('returns error on circular inquiry (targetRoleId is waiting for asker)', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(0);
      vi.mocked(suspensionManager.findSuspensionAwaitingRole).mockReturnValue({
        id: 'susp-1', roleId: 'role-b',
      } as any);

      const tool = findTool('capibara_ask_question');
      const result = await tool.handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?', targetRoleId: 'role-b' },
        'run-1',
      ) as any;

      expect(result.error).toContain('Circular inquiry detected');
    });

    it('passes targetRoleId to createInquiry', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(0);

      const tool = findTool('capibara_ask_question');
      await tool.handler(
        { orgId: 'org-1', askingRoleId: 'role-a', taskId: 'task-1', question: 'Q?', targetRoleId: 'role-target' },
        'run-1',
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
      tools = createConversationTools(conversationService, suspensionManager, testConfig);
    });

    it('creates inquiry for each target role', async () => {
      const tool = findTool('capibara_broadcast_question');
      const result = await tool.handler(
        {
          orgId: 'org-1',
          askingRoleId: 'role-a',
          taskId: 'task-1',
          targetRoleIds: ['role-b', 'role-c'],
          question: 'What do you think?',
        },
        'run-1',
      ) as any;

      expect(conversationService.createInquiry).toHaveBeenCalledTimes(2);
      expect(result.inquiries).toHaveLength(2);
      expect(result.waitMode).toBe('all');
    });

    it('returns error when targets exceed max', async () => {
      const tool = findTool('capibara_broadcast_question');
      const result = await tool.handler(
        {
          orgId: 'org-1',
          askingRoleId: 'role-a',
          taskId: 'task-1',
          targetRoleIds: ['r1', 'r2', 'r3', 'r4'],
          question: 'Q?',
        },
        'run-1',
      ) as any;

      expect(result.error).toContain('Too many targets');
    });

    it('returns error when no targets provided', async () => {
      const tool = findTool('capibara_broadcast_question');
      const result = await tool.handler(
        {
          orgId: 'org-1',
          askingRoleId: 'role-a',
          taskId: 'task-1',
          targetRoleIds: [],
          question: 'Q?',
        },
        'run-1',
      ) as any;

      expect(result.error).toContain('At least one target');
    });

    it('returns error when chain depth limit reached', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(3);
      const tool = findTool('capibara_broadcast_question');
      const result = await tool.handler(
        {
          orgId: 'org-1',
          askingRoleId: 'role-a',
          taskId: 'task-1',
          targetRoleIds: ['role-b'],
          question: 'Q?',
        },
        'run-1',
      ) as any;

      expect(result.error).toContain('Chain depth limit reached');
    });

    it('detects circular inquiry in broadcast targets', async () => {
      vi.mocked(suspensionManager.getChainDepth).mockReturnValue(0);
      vi.mocked(suspensionManager.findSuspensionAwaitingRole).mockReturnValue({
        id: 'susp-1', roleId: 'role-c',
      } as any);

      const tool = findTool('capibara_broadcast_question');
      const result = await tool.handler(
        {
          orgId: 'org-1',
          askingRoleId: 'role-a',
          taskId: 'task-1',
          targetRoleIds: ['role-b', 'role-c'],
          question: 'Q?',
        },
        'run-1',
      ) as any;

      expect(result.error).toContain('Circular inquiry detected');
      expect(result.error).toContain('role-c');
    });

    it('uses custom waitMode', async () => {
      const tool = findTool('capibara_broadcast_question');
      const result = await tool.handler(
        {
          orgId: 'org-1',
          askingRoleId: 'role-a',
          taskId: 'task-1',
          targetRoleIds: ['role-b'],
          question: 'Q?',
          waitMode: 'any',
        },
        'run-1',
      ) as any;

      expect(result.waitMode).toBe('any');
    });
  });
});
