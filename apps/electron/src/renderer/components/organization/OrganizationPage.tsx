import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, TreeStructure, Trash, CaretDown, CaretRight, FloppyDisk, FolderOpen } from '@phosphor-icons/react';
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
import { Button } from '../ui/button';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../ui/select';
import { Card } from '../ui/card';
import { useT } from '../../hooks/useLocale';

export function OrganizationPage() {
  const t = useT();
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showDeleteOrg, setShowDeleteOrg] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);
  const instructionsInitRef = useRef<string | null>(null);

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
      toast.error(t.errors.failedToLoad);
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
      toast.error(t.organization.failedToLoadRoles);
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
    } catch { toast.error(t.organization.failedToCreateRole); }
  };

  const handleUpdateRole = async (input: UpdateRoleInput) => {
    try {
      const result = await window.capibara.updateRole(input);
      if (result.ok) {
        await loadRoles(currentOrgId);
      }
    } catch { toast.error(t.organization.failedToUpdateRole); }
  };

  const handleDeleteRole = async (id: string) => {
    try {
      const result = await window.capibara.deleteRole(id);
      if (result.ok) {
        setSelectedRoleId(null);
        await loadRoles(currentOrgId);
      }
    } catch { toast.error(t.organization.failedToDeleteRole); }
  };

  const handleTemplateLoaded = async () => {
    setShowTemplateSelector(false);
    toast.success(t.organization.templateLoadedSuccessfully);
    try {
      await loadOrgs();
      const result = await window.capibara.getOrganizations();
      if (result.ok && result.data.length > 0) {
        setCurrentOrgId(result.data[result.data.length - 1].id);
      }
    } catch { toast.error(t.organization.failedToLoadTemplate); }
  };

  const handleCreateBlankOrg = async (name: string, description: string, workspacePath: string, customInstructions: string, workflowTemplateId: string | null) => {
    try {
      const result = await window.capibara.createOrganization({
        name,
        description,
        customInstructions,
        budgetLimit: 50.0,
        orgTemplateId: null,
        workflowTemplateId,
        workspacePath,
      });
      if (result.ok) {
        setShowCreateOrg(false);
        toast.success(t.organization.createdSuccessfully);
        setCurrentOrgId(result.data.id);
        await loadOrgs();
      } else {
        console.error('[CreateOrg] failed:', result.error);
      }
    } catch (err) {
      console.error('[CreateOrg] IPC error:', err);
      toast.error(t.organization.failedToCreateOrg);
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
        toast.success(t.organization.deletedSuccessfully);
        await loadOrgs();
      } else {
        toast.error(result.error.message);
      }
    } catch {
      toast.error(t.errors.failedToDelete);
    }
  };

  // Sync instructions draft when org changes
  const currentOrg = organizations.find((o) => o.id === currentOrgId);
  const currentInstructions = currentOrg?.customInstructions ?? '';
  if (instructionsInitRef.current !== currentOrgId) {
    instructionsInitRef.current = currentOrgId;
    if (instructionsDraft !== currentInstructions) {
      setInstructionsDraft(currentInstructions);
    }
  }

  const instructionsDirty = instructionsDraft !== currentInstructions;

  const handleSaveInstructions = async () => {
    if (!currentOrg) return;
    setIsSavingInstructions(true);
    try {
      const result = await window.capibara.updateOrganization({
        id: currentOrg.id,
        customInstructions: instructionsDraft.trim(),
      });
      if (result.ok) {
        toast.success(t.orgSettings.saved);
        await loadOrgs();
      }
    } catch {
      toast.error(t.orgSettings.failedToSave);
    } finally {
      setIsSavingInstructions(false);
    }
  };
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-[var(--page-padding)] overflow-auto">
        <div className="flex items-center justify-between mb-[var(--section-gap)]">
          <div>
            <h1 className="text-3xl font-semibold text-foreground font-[family-name:var(--font-display)]">{t.organization.title}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t.organization.subtitle}
            </p>
          </div>
          <div className="flex gap-2">
            {organizations.length > 0 && (
              <Select
                value={currentOrgId ?? ''}
                onValueChange={(val) => setCurrentOrgId(val)}
              >
                <SelectTrigger className="w-auto min-w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {currentOrg && (
              <>
                {currentOrg.workspacePath && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      const result = await window.capibara.openFolder(currentOrg.workspacePath);
                      if (!result.ok) toast.error(result.error.message);
                    }}
                    title={t.organization.openWorkspace}
                  >
                    <FolderOpen size={16} />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDeleteOrg(true)}
                  title={t.organization.deleteOrganization}
                >
                  <Trash size={16} />
                </Button>
              </>
            )}
            <Button onClick={() => setShowTemplateSelector(true)}>
              <TreeStructure size={16} />
              {t.organization.fromTemplate}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowCreateOrg(true)}
            >
              <Plus size={16} />
              {t.organization.blankOrg}
            </Button>
          </div>
        </div>

        {currentOrg && (
          <div className="mb-4">
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowInstructions((v) => !v)}
            >
              {showInstructions ? <CaretDown size={14} /> : <CaretRight size={14} />}
              {t.orgSettings.customInstructions}
              {currentInstructions && !showInstructions && (
                <span className="ml-1 text-xs text-muted-foreground/60">({currentInstructions.length} chars)</span>
              )}
            </button>
            {showInstructions && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">{t.orgSettings.customInstructionsHint}</p>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder={t.createOrg.customInstructionsPlaceholder}
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  maxLength={5000}
                  rows={4}
                />
                {instructionsDirty && (
                  <div className="flex justify-end mt-2">
                    <Button
                      size="sm"
                      onClick={handleSaveInstructions}
                      disabled={isSavingInstructions}
                    >
                      <FloppyDisk size={14} />
                      {isSavingInstructions ? t.common.saving : t.common.save}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
          <Card className="border-dashed p-12 text-center">
            <TreeStructure size={48} className="mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground mb-4">{t.organization.noRolesMessage}</p>
            <Button
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
              {t.organization.addRootRole}
            </Button>
          </Card>
        ) : (
          <Card className="border-dashed p-12 text-center">
            <TreeStructure size={48} className="mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              {t.organization.welcomeMessage}
            </p>
          </Card>
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
