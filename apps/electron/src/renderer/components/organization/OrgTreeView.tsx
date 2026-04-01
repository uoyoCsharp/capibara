import { useState } from 'react';
import { CaretRight, CaretDown, Plus, UserCircle } from '@phosphor-icons/react';
import type { RoleRecord } from '@shared/contracts';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

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
  active: 'bg-success',
  paused: 'bg-warning',
  idle: 'bg-neutral',
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
        className={cn(
          'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
          isSelected ? 'bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted',
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => onSelectRole(node.role.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
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
          className={cn(
            'flex-shrink-0',
            isSelected ? 'text-primary' : 'text-muted-foreground',
          )}
        />

        {/* Name and status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-sm font-medium truncate',
                isSelected ? 'text-primary' : 'text-foreground',
              )}
            >
              {node.role.name}
            </span>
            <span
              className={cn(
                'w-2 h-2 rounded-full flex-shrink-0',
                STATUS_COLORS[node.role.status] ?? 'bg-neutral',
              )}
            />
          </div>
          {node.role.persona && (
            <p className="text-xs text-muted-foreground truncate max-w-[280px]">
              {node.role.persona.slice(0, 80)}
            </p>
          )}
        </div>

        {/* Quick add child */}
        <button
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
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
      {expanded && (
        <div className="space-y-1.5 mt-1.5">
        {node.children.map((child) => (
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
      )}
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
    <Card className="py-3">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Role Hierarchy
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onAddRole(null)}
        >
          <Plus size={12} />
          Add Root
        </Button>
      </div>
      <div className="space-y-1 px-1">
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
    </Card>
  );
}
