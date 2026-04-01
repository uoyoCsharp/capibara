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
        className="flex items-center gap-2 text-xs text-gray-600"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <Users size={12} className="text-gray-400 flex-shrink-0" />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Choose Organization Template</h2>
          <button
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Template Cards */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {templates.map((template) => (
            <button
              key={template.id}
              className={`w-full text-left rounded-xl border p-4 transition-colors ${
                selectedId === template.id
                  ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
              onClick={() => setSelectedId(template.id)}
            >
              <div className="flex items-start gap-3">
                <TreeStructure
                  size={24}
                  className={selectedId === template.id ? 'text-indigo-500' : 'text-gray-400'}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{template.name}</span>
                    <span className="text-xs text-gray-400">
                      {countRoles(template.rootRoles)} roles
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                  {/* Role hierarchy preview */}
                  <div className="mt-3 space-y-1 bg-gray-50 rounded-lg p-3">
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
            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Organization Name *
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="My AI Team"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
