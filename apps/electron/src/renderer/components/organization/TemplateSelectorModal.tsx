import { useEffect, useState } from 'react';
import { X, TreeStructure, Users } from '@phosphor-icons/react';
import type { TemplateRecord, TemplateRoleDefinition } from '@shared/contracts';

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
        className="flex items-center gap-2 text-xs text-text-secondary"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <Users size={12} className="text-text-muted flex-shrink-0" />
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
    if (!selectedId || !orgName.trim()) return;
    setIsCreating(true);
    try {
      const result = await window.capibara.loadTemplate({
        templateId: selectedId,
        orgName: orgName.trim(),
        orgDescription: orgDescription.trim(),
        budgetLimit: 50.0,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay">
      <div className="bg-surface-card rounded-[var(--card-radius)] shadow-modal w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Choose Organization Template</h2>
          <button
            className="p-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Template Cards */}
        <div className="flex-1 overflow-auto p-6 space-y-5">
          {templates.map((template) => (
            <button
              key={template.id}
              className={`w-full text-left rounded-[var(--card-radius)] border p-4 transition-colors ${
                selectedId === template.id
                  ? 'border-accent bg-accent-subtle ring-1 ring-[var(--accent-ring)]'
                  : 'border-border-default hover:border-border-strong bg-surface-card'
              }`}
              onClick={() => setSelectedId(template.id)}
            >
              <div className="flex items-start gap-3">
                <TreeStructure
                  size={24}
                  className={selectedId === template.id ? 'text-accent' : 'text-text-muted'}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{template.name}</span>
                    <span className="text-xs text-text-muted">
                      {countRoles(template.rootRoles)} roles
                    </span>
                  </div>
                  <p className="text-sm text-text-tertiary mt-1">{template.description}</p>
                  {/* Role hierarchy preview */}
                  <div className="mt-3 space-y-1 bg-surface-sunken rounded-lg p-3">
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
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Organization Name *
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder-text-muted"
                  placeholder="My AI Team"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Description
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder-text-muted"
                  placeholder="Optional description"
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  maxLength={500}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <button
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleLoad}
            disabled={!selectedId || !orgName.trim() || isCreating}
          >
            {isCreating ? 'Creating...' : 'Create Organization'}
          </button>
        </div>
      </div>
    </div>
  );
}
