import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';

export function createConversationTools(
  conversationService: ConversationService,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_ask_question',
      description: 'Ask a question to another role, creating an inquiry conversation',
      inputSchema: {
        type: 'object',
        properties: {
          orgId: { type: 'string', description: 'Organization ID' },
          askingRoleId: { type: 'string', description: 'Role ID of the questioner' },
          taskId: { type: 'string', description: 'Associated task ID' },
          question: { type: 'string', description: 'The question content' },
        },
        required: ['orgId', 'askingRoleId', 'taskId', 'question'],
      },
      handler: async (params) => {
        const conv = conversationService.createInquiry(
          params.orgId as string,
          params.askingRoleId as string,
          params.taskId as string,
          params.question as string,
        );
        return {
          conversationId: conv.id,
          respondentRoleId: conv.respondentRoleId,
          state: conv.state,
        };
      },
    },
  ];
}
