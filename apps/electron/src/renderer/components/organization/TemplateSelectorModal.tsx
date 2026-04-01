import { useEffect, useState } from 'react';
import { TreeStructure, Users, FolderOpen } from '@phosphor-icons/react';
import type { TemplateRecord, TemplateRoleDefinition } from '@shared/contracts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../../lib/utils';

interface TemplateSelectorModalProps {
  onClose: () => void;
  onLoaded: () => void;
}

function countRoles(roles: TemplateRoleDefinition[]): number {
  return roles.reduce((acc, r) => acc + 1 + countRoles(r.children), 0);
}

function RolePreview({ role, depth }: { role: TemplateRoleDefinition; depth: number }) {
  return (
    <>
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <Users size={12} className="text-muted-foreground flex-shrink-0" />
        <span>{role.name}</span>
      </div>
      {role.children.map((child) => (
        <RolePreview key={child.name} role={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function TemplateSelectorModal({ onClose, onLoaded }: TemplateSelectorModalProps) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');

  const handleSelectFolder = async () => {
    const result = await window.capibara.selectFolder();
    if (result.ok && result.data) {
      setWorkspacePath(result.data);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const result = await window.capibara.getTemplates();
        if (result.ok) {
          setTemplates(result.data);
          if (result.data.length > 0) {
            setSelectedId(result.data[0].id);
          }
        }
      } catch {
        // IPC may fail
      }
    })();
  }, []);

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  const handleLoad = async () => {
    if (!selectedId || !orgName.trim() || !workspacePath) return;
    setIsCreating(true);
    try {
      const result = await window.capibara.loadTemplate({
        templateId: selectedId,
        orgName: orgName.trim(),
        orgDescription: orgDescription.trim(),
        budgetLimit: 50.0,
        workspacePath,
      });
      if (result.ok) {
        onLoaded();
      } else {
        console.error('[LoadTemplate] failed:', result.error);
      }
    } catch (err) {
      console.error('[LoadTemplate] IPC error:', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Choose Organization Template</DialogTitle>
          <DialogDescription className="sr-only">
            Select a template to create a new organization
          </DialogDescription>
        </DialogHeader>

        {/* Template Cards */}
        <div className="flex-1 overflow-auto space-y-5">
          {templates.map((template) => (
            <button
              key={template.id}
              className={cn(
                'w-full text-left rounded-lg border p-4 transition-colors',
                selectedId === template.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-border bg-card',
              )}
              onClick={() => setSelectedId(template.id)}
            >
              <div className="flex items-start gap-3">
                <TreeStructure
                  size={24}
                  className={selectedId === template.id ? 'text-primary' : 'text-muted-foreground'}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{template.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {countRoles(template.rootRoles)} roles
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                  {/* Role hierarchy preview */}
                  <div className="mt-3 space-y-1 bg-muted rounded-lg p-3">
                    {template.rootRoles.map((role) => (
                      <RolePreview key={role.name} role={role} depth={0} />
                    ))}
                  </div>
                </div>
              </div>
            </button>
          ))}

          {/* Org naming */}
          {selectedTemplate && (
            <div className="space-y-4 pt-3">
              <div>
                <Label htmlFor="tmpl-org-name" className="mb-1">
                  Organization Name *
                </Label>
                <Input
                  id="tmpl-org-name"
                  placeholder="My AI Team"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <Label htmlFor="tmpl-org-desc" className="mb-1">
                  Description
                </Label>
                <Input
                  id="tmpl-org-desc"
                  placeholder="Optional description"
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div>
                <Label htmlFor="tmpl-workspace" className="mb-1">
                  Workspace Folder *
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tmpl-workspace"
                    className="flex-1 bg-muted cursor-default"
                    placeholder="Select a folder..."
                    value={workspacePath}
                    readOnly
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSelectFolder}
                  >
                    <FolderOpen size={16} />
                    Browse
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleLoad}
            disabled={!selectedId || !orgName.trim() || !workspacePath || isCreating}
          >
            {isCreating ? 'Creating...' : 'Create Organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
