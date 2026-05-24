import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from '../mcp-server.builder';

export function registerConversationTools(server: McpServer, deps: McpServerDeps): void {
  const { conversationService } = deps;
  const suspensionManager = deps.suspensionManager ?? null;
  const maxChainDepth = deps.collaborationConfig?.maxChainDepth ?? 5;
  const maxBroadcastTargets = deps.collaborationConfig?.maxBroadcastTargets ?? 5;

  server.tool(
    'capibara_ask_question',
    'Ask a question to another role, creating an inquiry conversation',
    {
      orgId: z.string().describe('Organization ID'),
      askingRoleId: z.string().describe('Role ID of the questioner'),
      taskId: z.string().describe('Associated task ID'),
      question: z.string().describe('The question content'),
      targetRoleId: z.string().optional().describe('Optional: specific role to ask. If omitted, auto-routed.'),
    },
    async ({ orgId, askingRoleId, taskId, question, targetRoleId }) => {
      // Chain depth check
      if (suspensionManager) {
        const depth = suspensionManager.getChainDepth(orgId, askingRoleId);
        if (depth >= maxChainDepth) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: `Chain depth limit reached (${maxChainDepth}). Cannot create nested inquiry.`,
              suggestion: 'Try to resolve this question yourself based on available context.',
            }) }],
            isError: true,
          };
        }

        // Circular detection: cannot ask a role that is waiting for your response
        if (targetRoleId) {
          const awaitingSuspension = suspensionManager.findSuspensionAwaitingRole(askingRoleId, orgId);
          if (awaitingSuspension && awaitingSuspension.roleId === targetRoleId) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'Circular inquiry detected. Cannot ask a role that is waiting for your response.',
              }) }],
              isError: true,
            };
          }
        }
      }

      const conv = conversationService.createInquiry(
        orgId,
        askingRoleId,
        taskId,
        question,
        undefined,
        undefined,
        targetRoleId,
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          conversationId: conv.id,
          respondentRoleId: conv.respondentRoleId,
          state: conv.state,
        }) }],
      };
    },
  );

  server.tool(
    'capibara_broadcast_question',
    'Ask the same question to multiple roles simultaneously, creating inquiry conversations for each target',
    {
      orgId: z.string().describe('Organization ID'),
      askingRoleId: z.string().describe('Role ID of the questioner'),
      taskId: z.string().describe('Associated task ID'),
      targetRoleIds: z.array(z.string()).describe('Role IDs to broadcast the question to'),
      question: z.string().describe('The question content'),
      waitMode: z.enum(['all', 'any']).optional().describe('Wait for all replies or any single reply. Defaults to all.'),
    },
    async ({ orgId, askingRoleId, taskId, targetRoleIds, question, waitMode: rawWaitMode }) => {
      const waitMode = rawWaitMode ?? 'all';

      // Validate target count
      if (targetRoleIds.length > maxBroadcastTargets) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: `Too many targets (${targetRoleIds.length}). Maximum is ${maxBroadcastTargets}.`,
          }) }],
          isError: true,
        };
      }

      if (targetRoleIds.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'At least one target role is required.' }) }],
          isError: true,
        };
      }

      // Chain depth check
      if (suspensionManager) {
        const depth = suspensionManager.getChainDepth(orgId, askingRoleId);
        if (depth >= maxChainDepth) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: `Chain depth limit reached (${maxChainDepth}). Cannot create nested inquiry.`,
              suggestion: 'Try to resolve this question yourself based on available context.',
            }) }],
            isError: true,
          };
        }

        // Circular detection: cannot ask any role that is waiting for your response
        const awaitingSuspension = suspensionManager.findSuspensionAwaitingRole(askingRoleId, orgId);
        if (awaitingSuspension) {
          const circularTarget = targetRoleIds.find(t => t === awaitingSuspension.roleId);
          if (circularTarget) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Circular inquiry detected. Cannot ask ${circularTarget} — that role is waiting for your response.`,
              }) }],
              isError: true,
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
          taskId,
          question,
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
        content: [{ type: 'text' as const, text: JSON.stringify({
          inquiries: results,
          waitMode,
          message: targetRoleIds.length === 1
            ? `Question sent to ${targetRoleIds[0]}. Your session will be suspended until a reply is received.`
            : `Questions broadcast to ${targetRoleIds.join(', ')}. Your session will be suspended until ${waitMode === 'all' ? 'all replies are' : 'any reply is'} received.`,
        }) }],
      };
    },
  );
}
