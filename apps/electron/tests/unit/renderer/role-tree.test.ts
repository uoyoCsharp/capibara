import { describe, it, expect } from 'vitest';
import { buildRoleTree } from '@renderer/components/team/role-tree';
import type { RoleRecord } from '@core/shared/types';

function role(id: string, parentId: string | null = null): RoleRecord {
  return {
    id, orgId: 'org', name: id, parentId, persona: '', knowledgeBaseRefs: [],
    skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false,
    consecutiveWakeCount: 0, isSystemRole: false, status: 'active',
    createdAt: '', updatedAt: '',
  };
}

describe('buildRoleTree', () => {
  it('empty input returns empty tree', () => {
    expect(buildRoleTree([])).toEqual([]);
  });

  it('single root role', () => {
    const tree = buildRoleTree([role('a')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].role.id).toBe('a');
    expect(tree[0].children).toEqual([]);
  });

  it('parent/child hierarchy', () => {
    const tree = buildRoleTree([role('parent'), role('child', 'parent')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].role.id).toBe('parent');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].role.id).toBe('child');
  });

  it('deep hierarchy (3 levels)', () => {
    const tree = buildRoleTree([
      role('a'),
      role('b', 'a'),
      role('c', 'b'),
    ]);
    expect(tree[0].children[0].children[0].role.id).toBe('c');
  });

  it('orphan role (parent not in list) becomes root', () => {
    const tree = buildRoleTree([role('orphan', 'nonexistent')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].role.id).toBe('orphan');
  });

  it('multiple roots side-by-side', () => {
    const tree = buildRoleTree([role('a'), role('b'), role('c', 'a')]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.role.id).sort()).toEqual(['a', 'b']);
  });

  it('siblings under same parent', () => {
    const tree = buildRoleTree([
      role('p'),
      role('c1', 'p'),
      role('c2', 'p'),
    ]);
    expect(tree[0].children).toHaveLength(2);
  });
});
