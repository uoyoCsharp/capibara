import { useEffect, useState, useCallback } from 'react';
import { GearSix, FloppyDisk, Trash, Warning } from '@phosphor-icons/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface LogStats {
  totalSizeMB: number;
  fileCount: number;
  oldestMonth: string | null;
  newestMonth: string | null;
}

export function SettingsPage() {
  const [locale, setLocale] = useState('en-US');
  const [saving, setSaving] = useState(false);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [logAction, setLogAction] = useState<'idle' | 'confirming-all' | 'confirming-old' | 'clearing'>('idle');
  const [logResult, setLogResult] = useState<string | null>(null);

  useEffect(() => {
    api().getSetting('locale').then((result: { ok: boolean; data?: string | null }) => {
      if (result.ok && result.data) setLocale(result.data);
    });
  }, []);

  const refreshLogStats = useCallback(() => {
    api().getLogStats?.().then((result: { ok: boolean; data?: LogStats }) => {
      if (result.ok && result.data) setLogStats(result.data);
    });
  }, []);

  useEffect(() => { refreshLogStats(); }, [refreshLogStats]);

  const handleSave = async () => {
    setSaving(true);
    await api().setSetting('locale', locale);
    setSaving(false);
  };

  const handleClearAll = async () => {
    setLogAction('clearing');
    setLogResult(null);
    const result = await api().clearAllLogs?.();
    if (result?.ok) {
      setLogResult(`Deleted ${result.data.deletedFiles} files, freed ${result.data.freedMB} MB`);
    }
    setLogAction('idle');
    refreshLogStats();
  };

  const handleClearOld = async () => {
    setLogAction('clearing');
    setLogResult(null);
    const now = new Date();
    const cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await api().clearLogsBefore?.(cutoff);
    if (result?.ok) {
      setLogResult(`Deleted ${result.data.deletedFiles} files, freed ${result.data.freedMB} MB`);
    }
    setLogAction('idle');
    refreshLogStats();
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
        <h2 className="font-semibold">Execution Logs</h2>
        <p className="text-sm text-muted-foreground">
          Log files are created for each AI execution run. Over time these can accumulate and take up disk space.
        </p>

        {logStats && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <p className="text-muted-foreground text-xs">Total Size</p>
              <p className="font-medium">{logStats.totalSizeMB} MB</p>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <p className="text-muted-foreground text-xs">File Count</p>
              <p className="font-medium">{logStats.fileCount}</p>
            </div>
            {logStats.oldestMonth && (
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground text-xs">Oldest</p>
                <p className="font-medium">{logStats.oldestMonth}</p>
              </div>
            )}
            {logStats.newestMonth && (
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-muted-foreground text-xs">Newest</p>
                <p className="font-medium">{logStats.newestMonth}</p>
              </div>
            )}
          </div>
        )}

        {logResult && (
          <p className="text-sm text-green-600 bg-green-500/10 rounded-lg px-3 py-2">{logResult}</p>
        )}

        <div className="flex gap-2 flex-wrap">
          {logAction === 'confirming-old' ? (
            <div className="flex items-center gap-2">
              <Warning size={16} className="text-yellow-600" />
              <span className="text-sm">Delete logs older than this month?</span>
              <button onClick={handleClearOld} className="text-xs px-2 py-1 rounded bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">Confirm</button>
              <button onClick={() => setLogAction('idle')} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">Cancel</button>
            </div>
          ) : logAction === 'confirming-all' ? (
            <div className="flex items-center gap-2">
              <Warning size={16} className="text-red-600" />
              <span className="text-sm">Delete all log files? This cannot be undone.</span>
              <button onClick={handleClearAll} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-600 hover:bg-red-500/20">Confirm</button>
              <button onClick={() => setLogAction('idle')} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">Cancel</button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setLogAction('confirming-old')}
                disabled={logAction === 'clearing' || !logStats?.fileCount}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                <Trash size={14} />
                Clear Old Logs
              </button>
              <button
                onClick={() => setLogAction('confirming-all')}
                disabled={logAction === 'clearing' || !logStats?.fileCount}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                <Trash size={14} />
                Clear All Logs
              </button>
            </>
          )}
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
