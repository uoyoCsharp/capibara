import { useEffect, useCallback, useState } from 'react';
import { UsersThree, Plus } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import { useT } from '../../hooks/use-locale';
import { toast } from '../../store/toast.store';
import { useOrganizationStore } from '../../store/organization.store';
import { RoleDrawer } from './RoleDrawer';
import { RoleCard } from './RoleCard';
import { buildRoleTree } from './role-tree';

interface TeamPageProps {
  orgId: string | null;
}

export function TeamPage({ orgId }: TeamPageProps) {
  const t = useT();
  const roles = useOrganizationStore((s) => s.roles);
  const isLoading = useOrganizationStore((s) => s.isLoadingRoles);
  const loadRoles = useOrganizationStore((s) => s.loadRoles);
  const createRole = useOrganizationStore((s) => s.createRole);
  const updateRole = useOrganizationStore((s) => s.updateRole);
  const deleteRole = useOrganizationStore((s) => s.deleteRole);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  useEffect(() => { if (orgId) void loadRoles(orgId); }, [orgId, loadRoles]);

  const handleAddRole = useCallback(async (parentId: string | null) => {
    if (!orgId) return;
    const created = await createRole({
      orgId,
      name: 'New Agent',
      parentId,
      persona: '',
      knowledgeBaseRefs: [],
      skillIds: [],
      canApprove: false,
      canDelegate: false,
      requiresHumanApproval: false,
    });
    if (created) {
      await loadRoles(orgId);
      setSelectedRoleId(created.id);
    } else {
      toast.error(t.organization?.failedToCreateRole ?? 'Failed to create role');
    }
  }, [orgId, createRole, loadRoles, t]);

  const handleUpdateRole = useCallback(async (input: unknown) => {
    const updated = await updateRole(input);
    if (updated && orgId) await loadRoles(orgId);
    else if (!updated) toast.error(t.organization?.failedToUpdateRole ?? 'Failed to update role');
  }, [updateRole, loadRoles, orgId, t]);

  const handleDeleteRole = useCallback(async (id: string) => {
    if (!orgId) return;
    const ok = await deleteRole(id, orgId);
    if (ok) setSelectedRoleId(null);
    else toast.error(t.organization?.failedToDeleteRole ?? 'Failed to delete role');
  }, [deleteRole, orgId, t]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
  const visibleRoles = roles.filter((r) => !r.isSystemRole);
  const tree = buildRoleTree(visibleRoles);

  if (!orgId) return <EmptyOrgState t={t} />;

  return (
    <div className="flex h-full flex-col p-6">
      <header className="mb-6 flex items-start justify-between">
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
        <Button size="sm" onClick={() => void handleAddRole(null)}>
          <Plus size={14} />
          {t.teamPage?.addAgent ?? 'Add Agent'}
        </Button>
      </header>

      {isLoading ? (
        <LoadingPane />
      ) : visibleRoles.length === 0 ? (
        <EmptyRolesState t={t} />
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EmptyOrgState({ t }: { t: any }) {
  return (
    <div className="flex h-full flex-col p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{t.teamPage?.title ?? 'Team'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.teamPage?.subtitle ?? 'Manage your AI team hierarchy'}
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <UsersThree size={48} className="mx-auto mb-4 text-muted-foreground/50" />
          <p className="text-lg font-medium text-muted-foreground">
            {t.teamPage?.noOrgSelected ?? 'No workspace selected'}
          </p>
          <p className="text-sm text-muted-foreground/70">
            {t.teamPage?.noOrgHint ?? 'Select a workspace to view the team'}
          </p>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EmptyRolesState({ t }: { t: any }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <UsersThree size={48} className="mx-auto mb-4 text-muted-foreground/50" />
        <p className="text-lg font-medium text-muted-foreground">
          {t.teamPage?.noRoles ?? 'No roles yet'}
        </p>
        <p className="text-sm text-muted-foreground/70">
          {t.teamPage?.noRolesHint ?? 'Add roles to build your team'}
        </p>
      </div>
    </div>
  );
}

function LoadingPane() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}
