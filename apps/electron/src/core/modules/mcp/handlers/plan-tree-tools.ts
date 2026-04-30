import type { McpToolDefinition } from '../registry/mcp-tool.registry';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { RoleService } from '@core/modules/organization/services/role.service';
import type { PlanTreeNode, PlanTreeMode } from '@core/foundation/events';

export const MAX_TREE_NODES = 500;
export const MAX_TREE_DEPTH = 10;

export type PlanTreeValidationCode =
  | 'ROOT_TASK_NOT_FOUND'
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
    typeof o.description === 'string' && o.description.length > 0 &&
    typeof o.assigneeRoleId === 'string' && o.assigneeRoleId.length > 0 &&
    Array.isArray(o.children) && o.children.every(isDraftNode)
  );
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
  rootType: string;
  tree: PlanTreeNode;
  processEngine: ProcessEngine;
  validRoleIds: Set<string>;
}

export function validatePlanTree(args: ValidateArgs): PlanTreeValidationError | null {
  const { orgId, rootType, tree, processEngine, validRoleIds } = args;

  if (tree.type !== rootType) {
    return {
      code: 'ROOT_TYPE_MISMATCH',
      message: `Root node type "${tree.type}" does not match root task type "${rootType}".`,
      nodePath: '$',
    };
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
  eventPublisher: IEventPublisher,
): McpToolDefinition[] {
  return [
    {
      name: 'capibara_plan_submit_tree',
      description:
        'Submit the complete decomposition tree for the current task in a single call. ' +
        'The server validates structure (type compatibility, leaf/non-leaf rules, assignee roles, node count ≤500, depth ≤10) ' +
        'before accepting. In preview mode the tree waits for human approval; in eager mode it is persisted immediately.',
      inputSchema: {
        type: 'object',
        properties: {
          rootTaskId: { type: 'string', description: 'The current task ID (must be the root of the submitted tree)' },
          tree: {
            type: 'object',
            description:
              'The decomposition tree. The root node must match the current task type. ' +
              'Each node: { type, title, description, assigneeRoleId, children: [...] }. Leaves have children: [].',
          },
        },
        required: ['rootTaskId', 'tree'],
      },
      handler: async (params) => {
        const rootTaskId = params.rootTaskId as string;
        const rawTree = params.tree;

        if (!isDraftNode(rawTree)) {
          return {
            error: 'INVALID_TREE_SHAPE',
            message: 'Tree does not match required shape. Each node must include type, title, description, assigneeRoleId, children[].',
          };
        }
        const tree = rawTree;

        const rootTask = taskService.findById(rootTaskId);
        if (!rootTask) {
          return { error: 'ROOT_TASK_NOT_FOUND', message: `Root task "${rootTaskId}" not found.` };
        }

        const mode: PlanTreeMode | null =
          rootTask.planningMode === 'preview' ? 'preview' :
          rootTask.planningMode === 'eager' ? 'eager' :
          null;

        if (mode === null) {
          return {
            error: 'TOOL_NOT_ALLOWED_IN_MODE',
            message: `capibara_plan_submit_tree is not available for tasks with planningMode="${rootTask.planningMode}".`,
          };
        }

        const roles = roleService.findByOrgId(rootTask.orgId);
        const validRoleIds = new Set(roles.map((r) => r.id));

        const err = validatePlanTree({
          orgId: rootTask.orgId,
          rootType: rootTask.type,
          tree,
          processEngine,
          validRoleIds,
        });
        if (err) {
          return { error: err.code, message: err.message, nodePath: err.nodePath };
        }

        const assigneeFromRoot = rootTask.assigneeRoleId ?? tree.assigneeRoleId;

        eventPublisher.publish('plan-tree:submitted', {
          rootTaskId: rootTask.id,
          orgId: rootTask.orgId,
          roleId: assigneeFromRoot,
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

export const __testing__ = { countNodes, measureDepth, isDraftNode };
