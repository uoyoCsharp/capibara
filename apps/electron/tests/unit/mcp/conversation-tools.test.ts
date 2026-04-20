import { describe, it, expect, beforeEach } from 'vitest';
import { createConversationTools } from '@core/modules/mcp/handlers/conversation-tools';
import type { McpToolDefinition } from '@core/modules/mcp/registry/mcp-tool.registry';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';

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
});
