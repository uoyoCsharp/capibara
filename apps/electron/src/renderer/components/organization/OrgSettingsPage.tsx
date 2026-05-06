import { useEffect, useState } from 'react';
import { GearSix, FolderOpen, Trash, FloppyDisk } from '@phosphor-icons/react';
import { useAppSnapshot } from '../../hooks/use-app-snapshot';
import { useOrganizationStore } from '../../store/organization.store';
import { useT } from '../../hooks/use-locale';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

interface OrgSettingsPageProps {
  orgId: string | null;
  onDeleted?: () => void;
}

export function OrgSettingsPage({ orgId, onDeleted }: OrgSettingsPageProps) {
  const t = useT();
  const { organizations, refresh } = useAppSnapshot();
  const updateOrganization = useOrganizationStore((s) => s.updateOrganization);
  const deleteOrganization = useOrganizationStore((s) => s.deleteOrganization);

  const org = organizations.find((o) => o.id === orgId) ?? null;

  const [form, setForm] = useState({
    name: '',
    description: '',
    customInstructions: '',
    budgetLimit: 50,
    autoStartOnCreate: true,
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
        autoStartOnCreate: org.autoStartOnCreate ?? true,
        status: org.status,
      });
    }
  }, [org]);

  if (!org) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <GearSix size={48} weight="duotone" />
        <p>{t.orgSettings.noOrgSelected}</p>
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
      autoStartOnCreate: form.autoStartOnCreate,
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

  const openFolder = () => {
    if (org.workspacePath) void window.capibara.openFolder(org.workspacePath);
  };

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)] max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GearSix size={28} weight="duotone" />
          {t.orgSettings.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{org.name}</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t.orgSettings.nameLabel}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t.orgSettings.descriptionLabel}</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t.orgSettings.customInstructionsLabel}</label>
          <textarea
            value={form.customInstructions}
            onChange={(e) => setForm((f) => ({ ...f, customInstructions: e.target.value }))}
            rows={4}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">{t.orgSettings.budgetLabel}</label>
            <input
              type="number"
              value={form.budgetLimit}
              onChange={(e) => setForm((f) => ({ ...f, budgetLimit: parseFloat(e.target.value) || 0 }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t.orgSettings.statusLabel}</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="active">{t.orgSettings.statusActive}</option>
              <option value="paused">{t.orgSettings.statusPaused}</option>
              <option value="archived">{t.orgSettings.statusArchived}</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <label className="text-sm font-medium">{t.orgSettings.autoStartLabel}</label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.orgSettings.autoStartDescription}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.autoStartOnCreate}
            onClick={() => setForm((f) => ({ ...f, autoStartOnCreate: !f.autoStartOnCreate }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              form.autoStartOnCreate ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              form.autoStartOnCreate ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        <div>
          <label className="text-sm font-medium">{t.orgSettings.workspacePathLabel}</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="flex-1 px-3 py-2 rounded-lg border border-border bg-muted text-sm text-muted-foreground truncate">
              {org.workspacePath || t.orgSettings.workspacePathNotSet}
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
          {saving ? t.orgSettings.saving : t.orgSettings.save}
        </button>

        <button
          onClick={() => setShowDelete(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-destructive/30 text-destructive text-sm hover:bg-destructive/10 transition-colors"
        >
          <Trash size={16} />
          {t.orgSettings.deleteBtn}
        </button>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl p-6 w-96 space-y-4 shadow-xl border border-border">
            <h3 className="text-lg font-semibold">{t.orgSettings.deleteTitle}</h3>
            <p className="text-sm text-muted-foreground">
              {interpolate(t.orgSettings.deleteMessage, { name: org.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDelete(false)}
                className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-sm hover:bg-destructive/90 transition-colors"
              >
                {t.common.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
