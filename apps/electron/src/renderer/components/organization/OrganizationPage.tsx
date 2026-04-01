import { useEffect, useState, useCallback } from 'react';
import { Plus, TreeStructure } from '@phosphor-icons/react';
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

export function OrganizationPage() {
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
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
      // IPC may fail
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
      // IPC may fail
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
    } catch { /* IPC may fail */ }
  };

  const handleUpdateRole = async (input: UpdateRoleInput) => {
    try {
      const result = await window.capibara.updateRole(input);
      if (result.ok) {
        await loadRoles(currentOrgId);
      }
    } catch { /* IPC may fail */ }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      const result = await window.capibara.deleteRole(id);
      if (result.ok) {
        setSelectedRoleId(null);
        await loadRoles(currentOrgId);
      }
    } catch { /* IPC may fail */ }
  };

  const handleTemplateLoaded = async () => {
    setShowTemplateSelector(false);
    try {
      await loadOrgs();
      const result = await window.capibara.getOrganizations();
      if (result.ok && result.data.length > 0) {
        setCurrentOrgId(result.data[result.data.length - 1].id);
      }
    } catch { /* IPC may fail */ }
  };

  const handleCreateBlankOrg = async (name: string, description: string) => {
    try {
      const result = await window.capibara.createOrganization({
        name,
        description,
        budgetLimit: 50.0,
        orgTemplateId: null,
      });
      if (result.ok) {
        setShowCreateOrg(false);
        setCurrentOrgId(result.data.id);
        await loadOrgs();
      }
    } catch { /* IPC may fail */ }
  };

  const currentOrg = organizations.find((o) => o.id === currentOrgId);
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-8 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Organization</h1>
            <p className="text-gray-500 text-sm mt-1">
              Manage your AI organization tree. Create roles, configure personas, and assign skills.
            </p>
          </div>
          <div className="flex gap-2">
            {organizations.length > 0 && (
              <select
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            <button
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              onClick={() => setShowTemplateSelector(true)}
            >
              <TreeStructure size={16} />
              From Template
            </button>
            <button
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <TreeStructure size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-sm text-gray-500 mb-4">No roles yet. Add a role to start building your org tree.</p>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
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
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <TreeStructure size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-sm text-gray-500 mb-4">
              No organization yet. Create one from a template or start blank.
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
    </div>
  );
}
