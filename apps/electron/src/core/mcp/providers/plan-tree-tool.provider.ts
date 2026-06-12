import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpProtocolDeps } from '@core/infrastructure/mcp-protocol/mcp-server.builder';
import type { PlanTreeNode, PlanTreeMode } from '@core/foundation/events';
import type { PlanTreeValidationError } from '@core/modules/planning/validation/plan-tree.validator';

function isDraftNode(v: unknown): v is PlanTreeNode {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.type === 'string' && o.type.length > 0 &&
    typeof o.title === 'string' && o.title.length > 0 &&
    typeof o.description === 'string' &&
    typeof o.assigneeRoleId === 'string' && o.assigneeRoleId.length > 0 &&
    (o.dependsOn === undefined || o.dependsOn === null ||
      (Array.isArray(o.dependsOn) && o.dependsOn.every((d) => typeof d === 'string' && d.length > 0))) &&
    ((o.children === undefined || o.children === null) ||
      (Array.isArray(o.children) && o.children.every(isDraftNode)))
  );
}

function normalizeDraftNode(v: unknown): PlanTreeNode {
  const o = v as Record<string, unknown>;
  const rawChildren = Array.isArray(o.children) ? o.children : [];
  const rawDependsOn = Array.isArray(o.dependsOn) ? o.dependsOn : undefined;
  return {
    type: o.type as string,
    title: o.title as string,
    description: o.description as string,
    assigneeRoleId: o.assigneeRoleId as string,
    dependsOn: rawDependsOn as string[] | undefined,
    children: rawChildren.map((c) => normalizeDraftNode(c)),
  };
}

export function registerPlanTreeToolProvider(server: McpServer, deps: McpProtocolDeps): void {
  const { taskService, processEngine, conversationService, planningService } = deps;

  // The tree input is a recursive structure that Zod cannot fully validate
  // (recursive lazy schemas are not supported by Standard Schema).
  // We use z.record() as a passthrough and rely on isDraftNode() for structural validation.
  server.registerTool(
    'capibara_plan_submit_tree',
    {
      description: 'Submit a complete decomposition tree in a single call. Anchored to either a task ' +
        '(rootTaskId) or a conversation (conversationId) - provide exactly one. ' +
        'Task anchor: tree root node type must match the task type; mode follows the task\'s planningMode ' +
        '(preview waits for approval, eager persists immediately). ' +
        'Conversation anchor (planning conversations): tree root may be any allowedAtRoot type; ' +
        'mode is always preview (human approval required); on approval the tree\'s root + descendants ' +
        'are created as root-level tasks. ' +
        'Server validates structure (type compatibility, leaf/non-leaf rules, assignee roles, node count <=500, depth <=10).',
      inputSchema: {
        rootTaskId: z.string().optional().describe(
          'Task anchor - the current task ID (tree root type must match the task). Provide this OR conversationId.',
        ),
        conversationId: z.string().optional().describe(
          'Conversation anchor - the planning conversation ID. Provide this OR rootTaskId.',
        ),
        tree: z.record(z.unknown()).describe(
          'The decomposition tree. Each node: { type, title, description, assigneeRoleId, dependsOn?: string[], children: [...] }. ' +
          'Leaves have children: []. ' +
          'dependsOn is optional: an array of sibling task titles this task depends on (e.g. ["Design API", "Write tests"]). ' +
          'Dependencies enforce execution order - a task cannot start until all its dependencies are complete.',
        ),
      },
    },
    async ({ rootTaskId: rawRootTaskId, conversationId: rawConversationId, tree: rawTree }) => {
      const rootTaskId = rawRootTaskId ?? null;
      const conversationId = rawConversationId ?? null;

      if ((rootTaskId === null) === (conversationId === null)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'INVALID_ANCHOR',
            message: 'Provide exactly one of rootTaskId or conversationId.',
          }) }],
          isError: true,
        };
      }

      if (!isDraftNode(rawTree)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'INVALID_TREE_SHAPE',
            message: 'Tree does not match required shape. Each node must include type, title, description, assigneeRoleId, children[].',
          }) }],
          isError: true,
        };
      }
      const tree = normalizeDraftNode(rawTree);

      let orgId: string;
      let agentRoleId: string;
      let rootType: string | null;
      let mode: PlanTreeMode;

      if (rootTaskId) {
        const rootTask = taskService.findById(rootTaskId);
        if (!rootTask) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'ROOT_TASK_NOT_FOUND', message: `Root task "${rootTaskId}" not found.`,
            }) }],
            isError: true,
          };
        }
        const rootStatusCategory = processEngine.getStatusCategory(rootTask.orgId, rootTask.status);
        if (rootStatusCategory === 'terminal') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'ROOT_TASK_TERMINAL',
              message: `Task "${rootTaskId}" is in terminal status "${rootTask.status}" and cannot be decomposed.`,
            }) }],
            isError: true,
          };
        }
        orgId = rootTask.orgId;
        agentRoleId = rootTask.assigneeRoleId ?? tree.assigneeRoleId;
        rootType = rootTask.type;
        mode = rootTask.planningMode;
      } else {
        const conversation = conversationService.findById(conversationId!);
        if (!conversation) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'CONVERSATION_NOT_FOUND', message: `Conversation "${conversationId}" not found.`,
            }) }],
            isError: true,
          };
        }
        if (conversation.type !== 'planning') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'INVALID_CONVERSATION_TYPE',
              message: `Conversation "${conversationId}" has type "${conversation.type}"; expected "planning".`,
            }) }],
            isError: true,
          };
        }
        orgId = conversation.orgId;
        agentRoleId = conversation.respondentRoleId ?? tree.assigneeRoleId;
        rootType = null;
        mode = 'preview';
      }

      try {
        const result = planningService.submit({
          rootTaskId,
          sourceConversationId: conversationId,
          orgId,
          roleId: agentRoleId,
          rootType,
          mode,
          tree,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            ok: true,
            mode: result.mode,
            nodeCount: result.nodeCount,
            maxDepth: result.maxDepth,
          }) }],
        };
      } catch (err) {
        const validationErr = err as PlanTreeValidationError;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: validationErr.code ?? 'VALIDATION_FAILED',
            message: validationErr.message ?? String(err),
            nodePath: validationErr.nodePath,
          }) }],
          isError: true,
        };
      }
    },
  );
}

export const __testing__ = { isDraftNode, normalizeDraftNode };
