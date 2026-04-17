import { useEffect, useState } from 'react';
import { GearSix, FloppyDisk } from '@phosphor-icons/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

export function SettingsPage() {
  const [locale, setLocale] = useState('en-US');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api().getSetting('locale').then((result: { ok: boolean; data?: string | null }) => {
      if (result.ok && result.data) setLocale(result.data);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await api().setSetting('locale', locale);
    setSaving(false);
  };

  return (
    <div className="p-[var(--page-padding)] max-w-2xl space-y-[var(--section-gap)]">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GearSix size={28} weight="duotone" />
          Settings
        </h1>
      </div>

      <div className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <h2 className="font-semibold">Language</h2>
        <div>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="en-US">English</option>
            <option value="zh-CN">Chinese (Simplified)</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <h2 className="font-semibold">System</h2>
        <button
          onClick={async () => {
            const result = await api().getSystemHealth();
            if (result.ok) alert(`System OK: ${result.data.timestamp}`);
          }}
          className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          Check System Health
        </button>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        <FloppyDisk size={16} />
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
