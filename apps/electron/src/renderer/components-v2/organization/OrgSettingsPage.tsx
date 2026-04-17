import { useEffect, useState } from 'react';
import { GearSix, FolderOpen, Trash, FloppyDisk } from '@phosphor-icons/react';
import { useAppSnapshot } from '../../hooks-v2/use-app-snapshot';
import { useOrganizationStore } from '../../store-v2/organization.store';

interface OrgSettingsPageProps {
  orgId: string | null;
  onDeleted?: () => void;
}

export function OrgSettingsPage({ orgId, onDeleted }: OrgSettingsPageProps) {
  const { organizations, refresh } = useAppSnapshot();
  const updateOrganization = useOrganizationStore((s) => s.updateOrganization);
  const deleteOrganization = useOrganizationStore((s) => s.deleteOrganization);

  const org = organizations.find((o) => o.id === orgId) ?? null;

  const [form, setForm] = useState({
    name: '',
    description: '',
    customInstructions: '',
    budgetLimit: 50,
    status: 'active' as string,
  });
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    if (org) {
      setForm({
        name: org.name,
        description: org.description,
        customInstructions: org.customInstructions,
        budgetLimit: org.budgetLimit,
        status: org.status,
      });
    }
  }, [org]);

  if (!org) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <GearSix size={48} weight="duotone" />
        <p>Select an organization to view settings</p>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await updateOrganization({
      id: org.id,
      name: form.name,
      description: form.description,
      customInstructions: form.customInstructions,
      budgetLimit: form.budgetLimit,
      status: form.status,
    });
    await refresh();
    setSaving(false);
  };

  const handleDelete = async () => {
    const ok = await deleteOrganization(org.id);
    if (ok) {
      setShowDelete(false);
      await refresh();
      onDeleted?.();
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openFolder = () => (window.capibara as any).openFolder?.(org.workspacePath);

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)] max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GearSix size={28} weight="duotone" />
          Organization Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{org.name}</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Custom Instructions</label>
          <textarea
            value={form.customInstructions}
            onChange={(e) => setForm((f) => ({ ...f, customInstructions: e.target.value }))}
            rows={4}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Budget Limit ($)</label>
            <input
              type="number"
              value={form.budgetLimit}
              onChange={(e) => setForm((f) => ({ ...f, budgetLimit: parseFloat(e.target.value) || 0 }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Workspace Path</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="flex-1 px-3 py-2 rounded-lg border border-border bg-muted text-sm text-muted-foreground truncate">
              {org.workspacePath || 'Not set'}
            </span>
            {org.workspacePath && (
              <button onClick={openFolder} className="p-2 rounded-lg border border-border hover:bg-accent transition-colors">
                <FolderOpen size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <FloppyDisk size={16} />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>

        <button
          onClick={() => setShowDelete(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-destructive/30 text-destructive text-sm hover:bg-destructive/10 transition-colors"
        >
          <Trash size={16} />
          Delete Organization
        </button>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl p-6 w-96 space-y-4 shadow-xl border border-border">
            <h3 className="text-lg font-semibold">Delete Organization</h3>
            <p className="text-sm text-muted-foreground">
              This will permanently delete <strong>{org.name}</strong> and all its data. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDelete(false)}
                className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-sm hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
