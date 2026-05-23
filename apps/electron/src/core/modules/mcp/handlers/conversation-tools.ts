import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { ISessionSuspensionManager } from '@core/modules/acp/interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';

export function createConversationTools(
  conversationService: ConversationService,
  suspensionManager?: ISessionSuspensionManager | null,
  collaborationConfig?: CollaborationConfig | null,
): McpToolDefinition[] {
  const maxChainDepth = collaborationConfig?.maxChainDepth ?? 5;
  const maxBroadcastTargets = collaborationConfig?.maxBroadcastTargets ?? 5;

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
          targetRoleId: { type: 'string', description: 'Optional: specific role to ask. If omitted, auto-routed.' },
        },
        required: ['orgId', 'askingRoleId', 'taskId', 'question'],
      },
      handler: async (params) => {
        const orgId = params.orgId as string;
        const askingRoleId = params.askingRoleId as string;
        const targetRoleId = params.targetRoleId as string | undefined;

        // Chain depth check
        if (suspensionManager) {
          const depth = suspensionManager.getChainDepth(orgId, askingRoleId);
          if (depth >= maxChainDepth) {
            return {
              error: `Chain depth limit reached (${maxChainDepth}). Cannot create nested inquiry.`,
              suggestion: 'Try to resolve this question yourself based on available context.',
            };
          }

          // Circular detection: cannot ask a role that is waiting for your response
          if (targetRoleId) {
            const awaitingSuspension = suspensionManager.findSuspensionAwaitingRole(askingRoleId, orgId);
            if (awaitingSuspension && awaitingSuspension.roleId === targetRoleId) {
              return {
                error: 'Circular inquiry detected. Cannot ask a role that is waiting for your response.',
              };
            }
          }
        }

        const conv = conversationService.createInquiry(
          orgId,
          askingRoleId,
          params.taskId as string,
          params.question as string,
          undefined,
          undefined,
          targetRoleId,
        );

        return {
          conversationId: conv.id,
          respondentRoleId: conv.respondentRoleId,
          state: conv.state,
        };
      },
    },
    {
      name: 'capibara_broadcast_question',
      description: 'Ask the same question to multiple roles simultaneously, creating inquiry conversations for each target',
      inputSchema: {
        type: 'object',
        properties: {
          orgId: { type: 'string', description: 'Organization ID' },
          askingRoleId: { type: 'string', description: 'Role ID of the questioner' },
          taskId: { type: 'string', description: 'Associated task ID' },
          targetRoleIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Role IDs to broadcast the question to',
          },
          question: { type: 'string', description: 'The question content' },
          waitMode: {
            type: 'string',
            enum: ['all', 'any'],
            description: 'Wait for all replies or any single reply. Defaults to all.',
          },
        },
        required: ['orgId', 'askingRoleId', 'taskId', 'targetRoleIds', 'question'],
      },
      handler: async (params) => {
        const orgId = params.orgId as string;
        const askingRoleId = params.askingRoleId as string;
        const targetRoleIds = params.targetRoleIds as string[];
        const waitMode = (params.waitMode as string) || 'all';

        // Validate target count
        if (targetRoleIds.length > maxBroadcastTargets) {
          return {
            error: `Too many targets (${targetRoleIds.length}). Maximum is ${maxBroadcastTargets}.`,
          };
        }

        if (targetRoleIds.length === 0) {
          return { error: 'At least one target role is required.' };
        }

        // Chain depth check
        if (suspensionManager) {
          const depth = suspensionManager.getChainDepth(orgId, askingRoleId);
          if (depth >= maxChainDepth) {
            return {
              error: `Chain depth limit reached (${maxChainDepth}). Cannot create nested inquiry.`,
              suggestion: 'Try to resolve this question yourself based on available context.',
            };
          }

          // Circular detection: cannot ask any role that is waiting for your response
          const awaitingSuspension = suspensionManager.findSuspensionAwaitingRole(askingRoleId, orgId);
          if (awaitingSuspension) {
            const circularTarget = targetRoleIds.find(t => t === awaitingSuspension.roleId);
            if (circularTarget) {
              return {
                error: `Circular inquiry detected. Cannot ask ${circularTarget} — that role is waiting for your response.`,
              };
            }
          }
        }

        // Create directed inquiry for each target
        const results: Array<{ conversationId: string; targetRoleId: string; respondentRoleId: string | null; state: string }> = [];
        for (const targetRoleId of targetRoleIds) {
          const conv = conversationService.createInquiry(
            orgId,
            askingRoleId,
            params.taskId as string,
            params.question as string,
            undefined,
            undefined,
            targetRoleId,
          );
          results.push({
            conversationId: conv.id,
            targetRoleId,
            respondentRoleId: conv.respondentRoleId,
            state: conv.state,
          });
        }

        return {
          inquiries: results,
          waitMode,
          message: targetRoleIds.length === 1
            ? `Question sent to ${targetRoleIds[0]}. Your session will be suspended until a reply is received.`
            : `Questions broadcast to ${targetRoleIds.join(', ')}. Your session will be suspended until ${waitMode === 'all' ? 'all replies are' : 'any reply is'} received.`,
        };
      },
    },
  ];
}
