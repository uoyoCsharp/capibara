import { useEffect, useState, useCallback } from 'react';
import { Plus, TreeStructure, Trash } from '@phosphor-icons/react';
import type {
  OrganizationRecord,
  RoleRecord,
  TemplateRecord,
  CreateRoleInput,
  UpdateRoleInput,
} from '@shared/contracts';
import { OrgTreeView } from './OrgTreeView';
import { RoleDrawer } from './RoleDrawer';
import { TemplateSelectorModal } from './TemplateSelectorModal';
import { CreateOrgModal } from './CreateOrgModal';
import { DeleteOrgModal } from './DeleteOrgModal';
import { toast } from '../../store/toast.store';

export function OrganizationPage() {
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showDeleteOrg, setShowDeleteOrg] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadOrgs = useCallback(async () => {
    try {
      const result = await window.capibara.getOrganizations();
      if (result.ok) {
        setOrganizations(result.data);
        if (result.data.length > 0) {
          setCurrentOrgId((prev) => prev ?? result.data[0].id);
        }
      }
    } catch {
      toast.error('Failed to load organizations');
    }
  }, []);

  const loadRoles = useCallback(async (orgId: string | null) => {
    if (!orgId) {
      setRoles([]);
      return;
    }
    try {
      const result = await window.capibara.getRolesByOrgId(orgId);
      if (result.ok) {
        setRoles(result.data);
      }
    } catch {
      toast.error('Failed to load roles');
    }
  }, []);

  useEffect(() => {
    loadOrgs().finally(() => setIsLoading(false));
  }, [loadOrgs]);

  useEffect(() => {
    loadRoles(currentOrgId);
  }, [currentOrgId, loadRoles]);

  const handleCreateRole = async (input: CreateRoleInput) => {
    try {
      const result = await window.capibara.createRole(input);
      if (result.ok) {
        await loadRoles(currentOrgId);
      }
    } catch { toast.error('Failed to create role'); }
  };

  const handleUpdateRole = async (input: UpdateRoleInput) => {
    try {
      const result = await window.capibara.updateRole(input);
      if (result.ok) {
        await loadRoles(currentOrgId);
      }
    } catch { toast.error('Failed to update role'); }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      const result = await window.capibara.deleteRole(id);
      if (result.ok) {
        setSelectedRoleId(null);
        await loadRoles(currentOrgId);
      }
    } catch { toast.error('Failed to delete role'); }
  };

  const handleTemplateLoaded = async () => {
    setShowTemplateSelector(false);
    toast.success('Template loaded successfully');
    try {
      await loadOrgs();
      const result = await window.capibara.getOrganizations();
      if (result.ok && result.data.length > 0) {
        setCurrentOrgId(result.data[result.data.length - 1].id);
      }
    } catch { toast.error('Failed to load template'); }
  };

  const handleCreateBlankOrg = async (name: string, description: string, workspacePath: string) => {
    try {
      const result = await window.capibara.createOrganization({
        name,
        description,
        budgetLimit: 50.0,
        orgTemplateId: null,
        workspacePath,
      });
      if (result.ok) {
        setShowCreateOrg(false);
        toast.success('Organization created successfully');
        setCurrentOrgId(result.data.id);
        await loadOrgs();
      } else {
        console.error('[CreateOrg] failed:', result.error);
      }
    } catch (err) {
      console.error('[CreateOrg] IPC error:', err);
      toast.error('Failed to create organization');
    }
  };

  const handleDeleteOrg = async () => {
    if (!currentOrg) return;
    try {
      const result = await window.capibara.deleteOrganization({
        orgId: currentOrg.id,
        confirmName: currentOrg.name,
      });
      if (result.ok) {
        setShowDeleteOrg(false);
        setCurrentOrgId(null);
        setRoles([]);
        setSelectedRoleId(null);
        toast.success('Organization deleted successfully');
        await loadOrgs();
      } else {
        toast.error(result.error.message);
      }
    } catch {
      toast.error('Failed to delete organization');
    }
  };

  const currentOrg = organizations.find((o) => o.id === currentOrgId);
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-[var(--page-padding)] overflow-auto">
        <div className="flex items-center justify-between mb-[var(--section-gap)]">
          <div>
            <h1 className="text-3xl font-semibold text-text-primary font-[family-name:var(--font-display)]">Organization</h1>
            <p className="text-text-secondary text-sm mt-1">
              Manage your AI organization tree. Create roles, configure personas, and assign skills.
            </p>
          </div>
          <div className="flex gap-2">
            {organizations.length > 0 && (
              <select
                className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
                value={currentOrgId ?? ''}
                onChange={(e) => setCurrentOrgId(e.target.value)}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            )}
            {currentOrg && (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                onClick={() => setShowDeleteOrg(true)}
                title="Delete Organization"
              >
                <Trash size={16} />
              </button>
            )}
            <button
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover transition-colors"
              onClick={() => setShowTemplateSelector(true)}
            >
              <TreeStructure size={16} />
              From Template
            </button>
            <button
              className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken transition-colors"
              onClick={() => setShowCreateOrg(true)}
            >
              <Plus size={16} />
              Blank Org
            </button>
          </div>
        </div>

        {currentOrg && roles.length > 0 ? (
          <OrgTreeView
            roles={roles}
            selectedRoleId={selectedRoleId}
            onSelectRole={setSelectedRoleId}
            onAddRole={(parentId) => {
              handleCreateRole({
                orgId: currentOrgId!,
                name: 'New Role',
                parentId,
                persona: '',
                knowledgeBaseRefs: [],
                skillIds: [],
                canApprove: false,
                canDelegate: false,
                requiresHumanApproval: false,
              });
            }}
          />
        ) : currentOrg ? (
          <div className="rounded-[var(--card-radius)] border border-dashed border-border-strong bg-surface-card p-12 text-center">
            <TreeStructure size={48} className="mx-auto text-text-disabled mb-4" />
            <p className="text-sm text-text-tertiary mb-4">This organization has no roles yet. Roles define your AI agents — each with a persona, skills, and permissions. Add a root role to get started.</p>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover"
              onClick={() =>
                handleCreateRole({
                  orgId: currentOrgId!,
                  name: 'Root Role',
                  parentId: null,
                  persona: '',
                  knowledgeBaseRefs: [],
                  skillIds: [],
                  canApprove: true,
                  canDelegate: true,
                  requiresHumanApproval: true,
                })
              }
            >
              <Plus size={16} />
              Add Root Role
            </button>
          </div>
        ) : (
          <div className="rounded-[var(--card-radius)] border border-dashed border-border-strong bg-surface-card p-12 text-center">
            <TreeStructure size={48} className="mx-auto text-text-disabled mb-4" />
            <p className="text-sm text-text-tertiary mb-4">
              Welcome to Capibara! Start by creating an organization — it's your AI agent team. You can load a pre-built template or create a blank org and add roles manually.
            </p>
          </div>
        )}
      </div>

      {/* Role Configuration Drawer */}
      {selectedRole && (
        <RoleDrawer
          role={selectedRole}
          roles={roles}
          onUpdate={handleUpdateRole}
          onDelete={handleDeleteRole}
          onClose={() => setSelectedRoleId(null)}
        />
      )}

      {/* Template Selector Modal */}
      {showTemplateSelector && (
        <TemplateSelectorModal
          onClose={() => setShowTemplateSelector(false)}
          onLoaded={handleTemplateLoaded}
        />
      )}

      {/* Create Blank Org Modal */}
      {showCreateOrg && (
        <CreateOrgModal
          onClose={() => setShowCreateOrg(false)}
          onCreate={handleCreateBlankOrg}
        />
      )}

      {/* Delete Organization Modal */}
      {showDeleteOrg && currentOrg && (
        <DeleteOrgModal
          orgName={currentOrg.name}
          onClose={() => setShowDeleteOrg(false)}
          onConfirm={handleDeleteOrg}
        />
      )}
    </div>
  );
}
