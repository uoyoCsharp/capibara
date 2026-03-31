import { useState } from 'react';
import { CaretRight, CaretDown, Plus, UserCircle } from '@phosphor-icons/react';
import type { RoleRecord } from '@shared/contracts';
import { clsx } from 'clsx';

interface OrgTreeViewProps {
  roles: RoleRecord[];
  selectedRoleId: string | null;
  onSelectRole: (id: string) => void;
  onAddRole: (parentId: string | null) => void;
}

interface TreeNode {
  role: RoleRecord;
  children: TreeNode[];
}

function buildTree(roles: RoleRecord[]): TreeNode[] {
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

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-400',
  paused: 'bg-orange-400',
  idle: 'bg-gray-300',
};

function RoleNode({
  node,
  depth,
  selectedRoleId,
  onSelectRole,
  onAddRole,
}: {
  node: TreeNode;
  depth: number;
  selectedRoleId: string | null;
  onSelectRole: (id: string) => void;
  onAddRole: (parentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedRoleId === node.role.id;

  return (
    <div>
      <div
        className={clsx(
          'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
          isSelected ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50',
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => onSelectRole(node.role.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {hasChildren ? (
            expanded ? <CaretDown size={14} /> : <CaretRight size={14} />
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Avatar */}
        <UserCircle
          size={28}
          weight="fill"
          className={clsx(
            'flex-shrink-0',
            isSelected ? 'text-indigo-500' : 'text-gray-400',
          )}
        />

        {/* Name and status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'text-sm font-medium truncate',
                isSelected ? 'text-indigo-700' : 'text-gray-800',
              )}
            >
              {node.role.name}
            </span>
            <span
              className={clsx(
                'w-2 h-2 rounded-full flex-shrink-0',
                STATUS_COLORS[node.role.status] ?? 'bg-gray-300',
              )}
            />
          </div>
          {node.role.persona && (
            <p className="text-xs text-gray-400 truncate max-w-[280px]">
              {node.role.persona.slice(0, 80)}
            </p>
          )}
        </div>

        {/* Quick add child */}
        <button
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
          title="Add child role"
          onClick={(e) => {
            e.stopPropagation();
            onAddRole(node.role.id);
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Children */}
      {expanded &&
        node.children.map((child) => (
          <RoleNode
            key={child.role.id}
            node={child}
            depth={depth + 1}
            selectedRoleId={selectedRoleId}
            onSelectRole={onSelectRole}
            onAddRole={onAddRole}
          />
        ))}
    </div>
  );
}

export function OrgTreeView({
  roles,
  selectedRoleId,
  onSelectRole,
  onAddRole,
}: OrgTreeViewProps) {
  const tree = buildTree(roles);

  return (
    <div className="rounded-xl border border-gray-200 bg-white py-2">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 mb-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Role Hierarchy
        </span>
        <button
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          onClick={() => onAddRole(null)}
        >
          <Plus size={12} />
          Add Root
        </button>
      </div>
      {tree.map((node) => (
        <RoleNode
          key={node.role.id}
          node={node}
          depth={0}
          selectedRoleId={selectedRoleId}
          onSelectRole={onSelectRole}
          onAddRole={(parentId) => onAddRole(parentId)}
        />
      ))}
    </div>
  );
}
