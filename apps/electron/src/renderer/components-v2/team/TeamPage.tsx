import { useEffect, useState, useCallback } from 'react';
import { UsersThree, Plus, UserCircle, ShieldCheck, TreeStructure } from '@phosphor-icons/react';
import { useOrganizationStore } from '../../store-v2/organization.store';
import type { RoleRecord } from '@core/shared/types';

interface TeamPageProps {
  orgId: string | null;
}

interface RoleNode {
  role: RoleRecord;
  children: RoleNode[];
}

function buildTree(roles: RoleRecord[]): RoleNode[] {
  const map = new Map<string, RoleNode>();
  const roots: RoleNode[] = [];

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

function RoleCard({ node, depth, onSelect }: { node: RoleNode; depth: number; onSelect: (id: string) => void }) {
  return (
    <div>
      <button
        onClick={() => onSelect(node.role.id)}
        className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors"
        style={{ marginLeft: `${depth * 1.5}rem` }}
      >
        <div className="flex items-center gap-2">
          <UserCircle size={20} weight="duotone" className="text-muted-foreground" />
          <span className="font-medium">{node.role.name}</span>
          {node.role.isSystemRole && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">System</span>
          )}
          {node.role.canApprove && (
            <ShieldCheck size={16} className="text-primary" />
          )}
          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
            node.role.status === 'active' ? 'bg-green-500/10 text-green-600' :
            node.role.status === 'paused' ? 'bg-yellow-500/10 text-yellow-600' :
            'bg-muted text-muted-foreground'
          }`}>
            {node.role.status}
          </span>
        </div>
        {node.role.persona && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{node.role.persona}</p>
        )}
      </button>
      {node.children.map((child) => (
        <RoleCard key={child.role.id} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function TeamPage({ orgId }: TeamPageProps) {
  const roles = useOrganizationStore((s) => s.roles);
  const isLoading = useOrganizationStore((s) => s.isLoadingRoles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (orgId) void loadRoles(orgId);
  }, [orgId, loadRoles]);

  const visibleRoles = roles.filter((r) => !r.isSystemRole);
  const tree = buildTree(visibleRoles);
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <UsersThree size={48} weight="duotone" />
        <p>Select an organization to view the team</p>
      </div>
    );
  }

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <TreeStructure size={28} weight="duotone" />
            Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{visibleRoles.length} roles</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus size={16} weight="bold" />
          Add Role
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : tree.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <UsersThree size={48} weight="duotone" />
          <p>No roles yet. Add roles or load from a template.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {tree.map((node) => (
            <RoleCard key={node.role.id} node={node} depth={0} onSelect={setSelectedRoleId} />
          ))}
        </div>
      )}
    </div>
  );
}
