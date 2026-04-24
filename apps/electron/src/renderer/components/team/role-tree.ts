import type { RoleRecord } from '@core/shared/types';

export interface TreeNode {
  role: RoleRecord;
  children: TreeNode[];
}

/**
 * Build a parent-pointing hierarchy from a flat Role list.
 * Roles whose parentId points to a missing/filtered role become roots.
 */
export function buildRoleTree(roles: RoleRecord[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const role of roles) {
    map.set(role.id, { role, children: [] });
  }
  for (const role of roles) {
    const node = map.get(role.id)!;
    if (role.parentId && map.has(role.parentId)) {
      map.get(role.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
