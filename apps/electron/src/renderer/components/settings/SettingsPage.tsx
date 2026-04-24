import { useEffect, useState, useCallback } from 'react';
import { GearSix, FloppyDisk, Trash, Warning } from '@phosphor-icons/react';

const api = () => window.capibara;

interface LogStats {
  totalSizeMB: number;
  fileCount: number;
  oldestMonth: string | null;
  newestMonth: string | null;
}

type LogAction = 'idle' | 'confirming-all' | 'confirming-old' | 'clearing';

export function SettingsPage() {
  const [locale, setLocale] = useState('en-US');
  const [saving, setSaving] = useState(false);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [logAction, setLogAction] = useState<LogAction>('idle');
  const [logResult, setLogResult] = useState<string | null>(null);

  useEffect(() => {
    void api().getSetting('locale').then((result) => {
      if (result.ok && result.data) setLocale(result.data);
    });
  }, []);

  const refreshLogStats = useCallback(() => {
    void api().getLogStats().then((result) => {
      if (result.ok) setLogStats(result.data);
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
    const result = await api().clearAllLogs();
    if (result.ok) {
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
    const result = await api().clearLogsBefore(cutoff);
    if (result.ok) {
      setLogResult(`Deleted ${result.data.deletedFiles} files, freed ${result.data.freedMB} MB`);
    }
    setLogAction('idle');
    refreshLogStats();
  };

  return (
    <div className="p-[var(--page-padding)] max-w-2xl space-y-[var(--section-gap)]">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GearSix size={28} weight="duotone" />
          Settings
        </h1>
      </header>

      <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <h2 className="font-semibold">Language</h2>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="en-US">English</option>
          <option value="zh-CN">Chinese (Simplified)</option>
        </select>
      </section>

      <LogsSection
        logStats={logStats}
        logAction={logAction}
        setLogAction={setLogAction}
        logResult={logResult}
        onClearAll={handleClearAll}
        onClearOld={handleClearOld}
      />

      <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
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
      </section>

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

interface LogsSectionProps {
  logStats: LogStats | null;
  logAction: LogAction;
  setLogAction: (action: LogAction) => void;
  logResult: string | null;
  onClearAll: () => void;
  onClearOld: () => void;
}

function LogsSection({ logStats, logAction, setLogAction, logResult, onClearAll, onClearOld }: LogsSectionProps) {
  const hasFiles = (logStats?.fileCount ?? 0) > 0;

  return (
    <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
      <h2 className="font-semibold">Execution Logs</h2>
      <p className="text-sm text-muted-foreground">
        Log files are created for each AI execution run. Over time these can accumulate and take up disk space.
      </p>

      {logStats && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <StatTile label="Total Size" value={`${logStats.totalSizeMB} MB`} />
          <StatTile label="File Count" value={String(logStats.fileCount)} />
          {logStats.oldestMonth && <StatTile label="Oldest" value={logStats.oldestMonth} />}
          {logStats.newestMonth && <StatTile label="Newest" value={logStats.newestMonth} />}
        </div>
      )}

      {logResult && (
        <p className="text-sm text-green-600 bg-green-500/10 rounded-lg px-3 py-2">{logResult}</p>
      )}

      <div className="flex gap-2 flex-wrap">
        {logAction === 'confirming-old' && (
          <ConfirmInline
            icon={<Warning size={16} className="text-yellow-600" />}
            label="Delete logs older than this month?"
            onConfirm={onClearOld}
            onCancel={() => setLogAction('idle')}
            confirmClass="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20"
          />
        )}
        {logAction === 'confirming-all' && (
          <ConfirmInline
            icon={<Warning size={16} className="text-red-600" />}
            label="Delete all log files? This cannot be undone."
            onConfirm={onClearAll}
            onCancel={() => setLogAction('idle')}
            confirmClass="bg-red-500/10 text-red-600 hover:bg-red-500/20"
          />
        )}
        {logAction !== 'confirming-old' && logAction !== 'confirming-all' && (
          <>
            <ClearButton
              label="Clear Old Logs"
              disabled={logAction === 'clearing' || !hasFiles}
              onClick={() => setLogAction('confirming-old')}
            />
            <ClearButton
              label="Clear All Logs"
              disabled={logAction === 'clearing' || !hasFiles}
              onClick={() => setLogAction('confirming-all')}
              danger
            />
          </>
        )}
      </div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function ConfirmInline({
  icon, label, onConfirm, onCancel, confirmClass,
}: {
  icon: React.ReactNode;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-sm">{label}</span>
      <button onClick={onConfirm} className={`text-xs px-2 py-1 rounded ${confirmClass}`}>Confirm</button>
      <button onClick={onCancel} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">Cancel</button>
    </div>
  );
}

function ClearButton({
  label, disabled, onClick, danger = false,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-500/10'
          : 'border-border hover:bg-accent'
      }`}
    >
      <Trash size={14} />
      {label}
    </button>
  );
}
