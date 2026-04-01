import { useState } from 'react';
import { X, Warning } from '@phosphor-icons/react';

interface DeleteOrgModalProps {
  orgName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteOrgModal({ orgName, onClose, onConfirm }: DeleteOrgModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const nameMatches = confirmName === orgName;

  const handleDelete = async () => {
    if (!nameMatches) return;
    setIsDeleting(true);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay">
      <div className="bg-surface-card rounded-[var(--card-radius)] shadow-modal w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-red-400">Delete Organization</h2>
          <button
            className="p-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-sunken"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
            <Warning size={20} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-text-secondary">
              This action <strong className="text-text-primary">cannot be undone</strong>. This will permanently delete the organization
              <strong className="text-text-primary"> {orgName}</strong> and all associated data including roles, tasks, discussions, runs, and cost entries.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Type <strong className="text-text-primary">{orgName}</strong> to confirm
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder-text-muted"
              placeholder={orgName}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoFocus
            />
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
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleDelete}
            disabled={!nameMatches || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Organization'}
          </button>
        </div>
      </div>
    </div>
  );
}
