import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { PlanTreeNode } from '@core/foundation/events';

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

export interface ValidateArgs {
  orgId: string;
  /** When non-null: root node type must match. When null: root must be an allowedAtRoot type. */
  rootType: string | null;
  tree: PlanTreeNode;
  processEngine: IProcessEngine;
  validRoleIds: Set<string>;
}

export function countNodes(tree: PlanTreeNode): number {
  let count = 1;
  for (const child of tree.children) count += countNodes(child);
  return count;
}

export function measureDepth(tree: PlanTreeNode, depth = 1): number {
  if (tree.children.length === 0) return depth;
  return Math.max(...tree.children.map((c) => measureDepth(c, depth + 1)));
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
