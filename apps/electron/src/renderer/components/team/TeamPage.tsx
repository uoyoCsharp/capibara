import { useState, useEffect, useCallback } from 'react';
import { UsersThree, Plus, UserCircle, ShieldCheck, CaretRight } from '@phosphor-icons/react';
import type { RoleRecord } from '@core/shared/types';
import { RoleDrawer } from './RoleDrawer';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/use-locale';
import { toast } from '../../store/toast.store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface TeamPageProps {
  orgId: string | null;
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

function RoleCard({
  node,
  depth,
  roles,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  roles: RoleRecord[];
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const parentName = node.role.parentId
    ? roles.find((r) => r.id === node.role.parentId)?.name
    : null;

  return (
    <div style={{ marginLeft: `${depth * 32}px` }}>
      {depth > 0 && (
        <div className="flex items-center gap-1 ml-2 mb-0.5 text-muted-foreground/40">
          <CaretRight size={10} />
          <div className="h-px w-4 bg-border" />
        </div>
      )}
      <Card
        className={`group cursor-pointer p-4 transition-all hover:shadow-md hover:ring-1 hover:ring-primary/30 ${
          node.role.requiresHumanApproval ? 'border-destructive/40' : ''
        }`}
        onClick={() => onSelect(node.role.id)}
      >
        <div className="flex items-start gap-3">
          <UserCircle
            size={36}
            weight="fill"
            className="flex-shrink-0 text-muted-foreground group-hover:text-primary transition-colors"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {node.role.name}
              </span>
              {node.role.requiresHumanApproval && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                  <ShieldCheck size={10} />
                  {t.teamPage?.humanApprovalBadge ?? 'Human Approval'}
                </Badge>
              )}
            </div>
            {parentName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.teamPage?.reportsTo ?? 'Reports to'}: {parentName}
              </p>
            )}
            {node.role.persona && (
              <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                {node.role.persona.slice(0, 120)}
              </p>
            )}
          </div>
        </div>
      </Card>

      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <RoleCard
              key={child.role.id}
              node={child}
              depth={depth + 1}
              roles={roles}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamPage({ orgId }: TeamPageProps) {
  const t = useT();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadRoles = useCallback(async () => {
    if (!orgId) { setRoles([]); return; }
    setIsLoading(true);
    try {
      const result = await api().getRolesByOrgId(orgId);
      if (result.ok) setRoles(result.data);
    } catch {
      toast.error(t.organization?.failedToLoadRoles ?? 'Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  }, [orgId, t]);

  useEffect(() => { void loadRoles(); }, [loadRoles]);

  const handleAddRole = async (parentId: string | null) => {
    if (!orgId) return;
    try {
      const input = {
        orgId,
        name: 'New Agent',
        parentId,
        persona: '',
        knowledgeBaseRefs: [],
        skillIds: [],
        canApprove: false,
        canDelegate: false,
        requiresHumanApproval: false,
      };
      const result = await api().createRole(input);
      if (result.ok) {
        await loadRoles();
        setSelectedRoleId(result.data.id);
      }
    } catch {
      toast.error(t.organization?.failedToCreateRole ?? 'Failed to create role');
    }
  };

  const handleUpdateRole = async (input: unknown) => {
    try {
      const result = await api().updateRole(input);
      if (result.ok) await loadRoles();
    } catch {
      toast.error(t.organization?.failedToUpdateRole ?? 'Failed to update role');
    }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      const result = await api().deleteRole(id);
      if (result.ok) {
        setSelectedRoleId(null);
        await loadRoles();
      }
    } catch {
      toast.error(t.organization?.failedToDeleteRole ?? 'Failed to delete role');
    }
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
  const visibleRoles = roles.filter((r) => !r.isSystemRole);
  const tree = buildTree(visibleRoles);

  if (!orgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">{t.teamPage?.title ?? 'Team'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.teamPage?.subtitle ?? 'Manage your AI team hierarchy'}</p>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <UsersThree size={48} className="mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">{t.teamPage?.noOrgSelected ?? 'No workspace selected'}</p>
            <p className="text-sm text-muted-foreground/70">{t.teamPage?.noOrgHint ?? 'Select a workspace to view the team'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t.teamPage?.title ?? 'Team'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.teamPage?.subtitle ?? 'Manage your AI team hierarchy'}
            {visibleRoles.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground/70">
                ({visibleRoles.length} {t.teamPage?.rolesCount ?? 'roles'})
              </span>
            )}
          </p>
        </div>
        <Button size="sm" onClick={() => handleAddRole(null)}>
          <Plus size={14} />
          {t.teamPage?.addAgent ?? 'Add Agent'}
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : visibleRoles.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <UsersThree size={48} className="mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-lg font-medium text-muted-foreground">{t.teamPage?.noRoles ?? 'No roles yet'}</p>
            <p className="text-sm text-muted-foreground/70">{t.teamPage?.noRolesHint ?? 'Add roles to build your team'}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-2">
          {tree.map((node) => (
            <RoleCard
              key={node.role.id}
              node={node}
              depth={0}
              roles={roles}
              onSelect={setSelectedRoleId}
            />
          ))}
        </div>
      )}

      {/* Role Drawer */}
      {selectedRole && (
        <RoleDrawer
          role={selectedRole}
          roles={roles}
          onUpdate={handleUpdateRole}
          onDelete={handleDeleteRole}
          onClose={() => setSelectedRoleId(null)}
        />
      )}
    </div>
  );
}
