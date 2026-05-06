import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { PlanTreeNode, PlanTreeMode } from '@core/foundation/events';

export const MAX_TREE_NODES = 500;
export const MAX_TREE_DEPTH = 10;

export type PlanTreeValidationCode =
  | 'ROOT_TASK_NOT_FOUND'
  | 'ROOT_TASK_TERMINAL'
  | 'TOOL_NOT_ALLOWED_IN_MODE'
  | 'ROOT_TYPE_MISMATCH'
  | 'UNKNOWN_WORK_ITEM_TYPE'
  | 'TYPE_NOT_IN_ALLOWED_CHILDREN'
  | 'LEAF_CANNOT_HAVE_CHILDREN'
  | 'NON_LEAF_MUST_HAVE_CHILDREN'
  | 'UNKNOWN_ROLE_ID'
  | 'TOO_MANY_NODES'
  | 'DEPTH_EXCEEDED'
  | 'INVALID_TREE_SHAPE';

export interface PlanTreeValidationError {
  code: PlanTreeValidationCode;
  message: string;
  nodePath?: string;
}

function isDraftNode(v: unknown): v is PlanTreeNode {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.type === 'string' && o.type.length > 0 &&
    typeof o.title === 'string' && o.title.length > 0 &&
    typeof o.description === 'string' &&
    typeof o.assigneeRoleId === 'string' && o.assigneeRoleId.length > 0 &&
    ((o.children === undefined || o.children === null) ||
      (Array.isArray(o.children) && o.children.every(isDraftNode)))
  );
}

function normalizeDraftNode(v: unknown): PlanTreeNode {
  const o = v as Record<string, unknown>;
  const rawChildren = Array.isArray(o.children) ? o.children : [];
  return {
    type: o.type as string,
    title: o.title as string,
    description: o.description as string,
    assigneeRoleId: o.assigneeRoleId as string,
    children: rawChildren.map((c) => normalizeDraftNode(c)),
  };
}

function countNodes(tree: PlanTreeNode): number {
  let count = 1;
  for (const child of tree.children) count += countNodes(child);
  return count;
}

function measureDepth(tree: PlanTreeNode, depth = 1): number {
  if (tree.children.length === 0) return depth;
  return Math.max(...tree.children.map((c) => measureDepth(c, depth + 1)));
}

interface ValidateArgs {
  orgId: string;
  /** When non-null: root node type must match. When null: root must be an allowedAtRoot type. */
  rootType: string | null;
  tree: PlanTreeNode;
  processEngine: ProcessEngine;
  validRoleIds: Set<string>;
}

export function validatePlanTree(args: ValidateArgs): PlanTreeValidationError | null {
  const { orgId, rootType, tree, processEngine, validRoleIds } = args;

  if (rootType !== null && tree.type !== rootType) {
    return {
      code: 'ROOT_TYPE_MISMATCH',
      message: `Root node type "${tree.type}" does not match root task type "${rootType}".`,
      nodePath: '$',
    };
  }

  if (rootType === null) {
    const rootTypeDef = processEngine.getWorkItemType(orgId, tree.type);
    if (!rootTypeDef) {
      return {
        code: 'UNKNOWN_WORK_ITEM_TYPE',
        message: `Unknown type "${tree.type}".`,
        nodePath: '$',
      };
    }
    if (!rootTypeDef.allowedAtRoot) {
      return {
        code: 'ROOT_TYPE_MISMATCH',
        message: `Type "${tree.type}" is not allowed at the root of the task hierarchy.`,
        nodePath: '$',
      };
    }
  }

  const totalNodes = countNodes(tree);
  if (totalNodes > MAX_TREE_NODES) {
    return {
      code: 'TOO_MANY_NODES',
      message: `Too many nodes (${totalNodes}/${MAX_TREE_NODES}). Split broader before refining.`,
    };
  }

  const maxDepth = measureDepth(tree);
  if (maxDepth > MAX_TREE_DEPTH) {
    return {
      code: 'DEPTH_EXCEEDED',
      message: `Tree depth ${maxDepth} exceeds limit ${MAX_TREE_DEPTH}.`,
    };
  }

  function walk(node: PlanTreeNode, parentType: string | null, path: string): PlanTreeValidationError | null {
    const typeDef = processEngine.getWorkItemType(orgId, node.type);
    if (!typeDef) {
      return { code: 'UNKNOWN_WORK_ITEM_TYPE', message: `Unknown type "${node.type}".`, nodePath: path };
    }

    if (parentType !== null) {
      const parentDef = processEngine.getWorkItemType(orgId, parentType);
      const allowed = parentDef?.allowedChildren ?? [];
      if (!allowed.includes(node.type)) {
        return {
          code: 'TYPE_NOT_IN_ALLOWED_CHILDREN',
          message: `Type "${node.type}" not allowed as child of "${parentType}". Allowed: [${allowed.join(', ') || 'none'}].`,
          nodePath: path,
        };
      }
    }

    if (typeDef.isLeaf && node.children.length > 0) {
      return {
        code: 'LEAF_CANNOT_HAVE_CHILDREN',
        message: `Leaf type "${node.type}" must have no children.`,
        nodePath: path,
      };
    }
    if (!typeDef.isLeaf && node.children.length === 0) {
      return {
        code: 'NON_LEAF_MUST_HAVE_CHILDREN',
        message: `Non-leaf type "${node.type}" must have at least one child.`,
        nodePath: path,
      };
    }

    if (!validRoleIds.has(node.assigneeRoleId)) {
      return {
        code: 'UNKNOWN_ROLE_ID',
        message: `Role "${node.assigneeRoleId}" is not a valid role in this organization.`,
        nodePath: path,
      };
    }

    for (let i = 0; i < node.children.length; i++) {
      const err = walk(node.children[i], node.type, `${path}.children[${i}]`);
      if (err) return err;
    }
    return null;
  }

  return walk(tree, null, '$');
}

export function createPlanTreeTools(
  taskService: TaskService,
  processEngine: ProcessEngine,
  roleService: RoleService,
  conversationService: ConversationService,
  eventPublisher: IEventPublisher,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_plan_submit_tree',
      description:
        'Submit a complete decomposition tree in a single call. Anchored to either a task ' +
        '(rootTaskId) or a conversation (conversationId) — provide exactly one. ' +
        'Task anchor: tree root node type must match the task type; mode follows the task\'s planningMode ' +
        '(preview waits for approval, eager persists immediately). ' +
        'Conversation anchor (planning conversations): tree root may be any allowedAtRoot type; ' +
        'mode is always preview (human approval required); on approval the tree\'s root + descendants ' +
        'are created as root-level tasks. ' +
        'Server validates structure (type compatibility, leaf/non-leaf rules, assignee roles, node count ≤500, depth ≤10).',
      inputSchema: {
        type: 'object',
        properties: {
          rootTaskId: {
            type: 'string',
            description: 'Task anchor — the current task ID (tree root type must match the task). Provide this OR conversationId.',
          },
          conversationId: {
            type: 'string',
            description: 'Conversation anchor — the planning conversation ID. Provide this OR rootTaskId.',
          },
          tree: {
            type: 'object',
            description:
              'The decomposition tree. For task anchor: root must match current task type. ' +
              'For conversation anchor: root must be an allowedAtRoot type. ' +
              'Each node: { type, title, description, assigneeRoleId, children: [...] }. Leaves have children: [].',
          },
        },
        required: ['tree'],
      },
      handler: async (params) => {
        const rootTaskId = (params.rootTaskId ?? null) as string | null;
        const conversationId = (params.conversationId ?? null) as string | null;
        const rawTree = params.tree;

        if ((rootTaskId === null) === (conversationId === null)) {
          return {
            error: 'INVALID_ANCHOR',
            message: 'Provide exactly one of rootTaskId or conversationId.',
          };
        }

        if (!isDraftNode(rawTree)) {
          return {
            error: 'INVALID_TREE_SHAPE',
            message: 'Tree does not match required shape. Each node must include type, title, description, assigneeRoleId, children[].',
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
            return { error: 'ROOT_TASK_NOT_FOUND', message: `Root task "${rootTaskId}" not found.` };
          }
          const rootStatusCategory = processEngine.getStatusCategory(rootTask.orgId, rootTask.status);
          if (rootStatusCategory === 'terminal') {
            return {
              error: 'ROOT_TASK_TERMINAL',
              message: `Task "${rootTaskId}" is in terminal status "${rootTask.status}" and cannot be decomposed.`,
            };
          }
          orgId = rootTask.orgId;
          agentRoleId = rootTask.assigneeRoleId ?? tree.assigneeRoleId;
          rootType = rootTask.type;
          mode = rootTask.planningMode;
        } else {
          const conversation = conversationService.findById(conversationId!);
          if (!conversation) {
            return { error: 'CONVERSATION_NOT_FOUND', message: `Conversation "${conversationId}" not found.` };
          }
          if (conversation.type !== 'planning') {
            return {
              error: 'INVALID_CONVERSATION_TYPE',
              message: `Conversation "${conversationId}" has type "${conversation.type}"; expected "planning".`,
            };
          }
          orgId = conversation.orgId;
          agentRoleId = conversation.respondentRoleId ?? tree.assigneeRoleId;
          rootType = null; // root must be allowedAtRoot, verified by validator
          mode = 'preview';
        }

        const roles = roleService.findByOrgId(orgId);
        const validRoleIds = new Set(roles.map((r) => r.id));

        const err = validatePlanTree({
          orgId,
          rootType,
          tree,
          processEngine,
          validRoleIds,
        });
        if (err) {
          return { error: err.code, message: err.message, nodePath: err.nodePath };
        }

        eventPublisher.publish('plan-tree:submitted', {
          rootTaskId,
          sourceConversationId: conversationId,
          orgId,
          roleId: agentRoleId,
          mode,
          tree,
          submittedAt: new Date().toISOString(),
        });

        return {
          ok: true,
          mode,
          nodeCount: countNodes(tree),
          maxDepth: measureDepth(tree),
        };
      },
    },
  ];
}

export const __testing__ = { countNodes, measureDepth, isDraftNode, normalizeDraftNode };
