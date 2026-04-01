import { useState } from 'react';
import { X, FolderOpen } from '@phosphor-icons/react';

interface CreateOrgModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string, workspacePath: string) => void;
}

export function CreateOrgModal({ onClose, onCreate }: CreateOrgModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');

  const handleSelectFolder = async () => {
    const result = await window.capibara.selectFolder();
    if (result.ok && result.data) {
      setWorkspacePath(result.data);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay">
      <div className="bg-surface-card rounded-[var(--card-radius)] shadow-modal w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Create Organization</h2>
          <button
            className="p-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Name *
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder-text-muted"
              placeholder="My Organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Workspace Folder *
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-lg border border-border-default bg-surface-sunken px-3 py-2 text-sm text-text-primary placeholder-text-muted cursor-default"
                placeholder="Select a folder..."
                value={workspacePath}
                readOnly
              />
              <button
                type="button"
                className="rounded-lg border border-border-default px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken flex items-center gap-1.5"
                onClick={handleSelectFolder}
              >
                <FolderOpen size={16} />
                Browse
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle">
          <button
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => onCreate(name.trim(), description.trim(), workspacePath)}
            disabled={!name.trim() || !workspacePath}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
