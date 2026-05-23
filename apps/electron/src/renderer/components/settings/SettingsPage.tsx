import { useState, useCallback, useEffect } from 'react';
import { GearSix, FloppyDisk, Trash, Warning } from '@phosphor-icons/react';
import { useLocaleContext, useT } from '../../hooks/use-locale';
import type { SupportedLocale } from '@shared/locale/types';
import { isSupportedLocale } from '@shared/locale/index';
import { AgentConfigPanel } from './AgentConfigPanel';

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

const api = () => window.capibara;

interface LogStats {
  totalSizeMB: number;
  fileCount: number;
  oldestMonth: string | null;
  newestMonth: string | null;
}

type LogAction = 'idle' | 'confirming-all' | 'confirming-old' | 'clearing';

export function SettingsPage() {
  const t = useT();
  const { locale: currentLocale, setLocale: commitLocale } = useLocaleContext();
  const [localeDraft, setLocaleDraft] = useState<SupportedLocale>(currentLocale);
  const [saving, setSaving] = useState(false);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [logAction, setLogAction] = useState<LogAction>('idle');
  const [logResult, setLogResult] = useState<string | null>(null);

  // Keep the draft in sync if the context locale updates from elsewhere
  // (e.g. another component triggered setLocale while Settings was open).
  useEffect(() => { setLocaleDraft(currentLocale); }, [currentLocale]);

  const refreshLogStats = useCallback(() => {
    void api().getLogStats().then((result) => {
      if (result.ok) setLogStats(result.data);
    });
  }, []);

  useEffect(() => { refreshLogStats(); }, [refreshLogStats]);

  const handleSave = async () => {
    setSaving(true);
    // commitLocale both updates the in-session LocaleContext (so UI strings
    // retranslate immediately) and persists via api().setSetting('locale', ...).
    commitLocale(localeDraft);
    setSaving(false);
  };

  const handleClearAll = async () => {
    setLogAction('clearing');
    setLogResult(null);
    const result = await api().clearAllLogs();
    if (result.ok) {
      setLogResult(interpolate(t.settings.logs.deleteResult, {
        count: result.data.deletedFiles,
        size: result.data.freedMB,
      }));
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
      setLogResult(interpolate(t.settings.logs.deleteResult, {
        count: result.data.deletedFiles,
        size: result.data.freedMB,
      }));
    }
    setLogAction('idle');
    refreshLogStats();
  };

  return (
    <div className="p-[var(--page-padding)] max-w-2xl space-y-[var(--section-gap)]">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GearSix size={28} weight="duotone" />
          {t.settings.title}
        </h1>
      </header>

      <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
        <h2 className="font-semibold">{t.settings.language.title}</h2>
        <select
          value={localeDraft}
          onChange={(e) => {
            const next = e.target.value;
            if (isSupportedLocale(next)) setLocaleDraft(next);
          }}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="en-US">{t.settings.language.english}</option>
          <option value="zh-CN">{t.settings.language.chinese}</option>
        </select>
      </section>

      <AgentConfigPanel />

      <LogsSection
        t={t}
        logStats={logStats}
        logAction={logAction}
        setLogAction={setLogAction}
        logResult={logResult}
        onClearAll={handleClearAll}
        onClearOld={handleClearOld}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        <FloppyDisk size={16} />
        {saving ? t.settings.saving : t.settings.save}
      </button>
    </div>
  );
}

interface LogsSectionProps {
  t: ReturnType<typeof useT>;
  logStats: LogStats | null;
  logAction: LogAction;
  setLogAction: (action: LogAction) => void;
  logResult: string | null;
  onClearAll: () => void;
  onClearOld: () => void;
}

function LogsSection({ t, logStats, logAction, setLogAction, logResult, onClearAll, onClearOld }: LogsSectionProps) {
  const hasFiles = (logStats?.fileCount ?? 0) > 0;

  return (
    <section className="rounded-xl border border-border p-[var(--card-padding)] space-y-4">
      <h2 className="font-semibold">{t.settings.logs.title}</h2>
      <p className="text-sm text-muted-foreground">
        {t.settings.logs.description}
      </p>

      {logStats && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <StatTile label={t.settings.logs.totalSize} value={`${logStats.totalSizeMB} MB`} />
          <StatTile label={t.settings.logs.fileCount} value={String(logStats.fileCount)} />
          {logStats.oldestMonth && <StatTile label={t.settings.logs.oldest} value={logStats.oldestMonth} />}
          {logStats.newestMonth && <StatTile label={t.settings.logs.newest} value={logStats.newestMonth} />}
        </div>
      )}

      {logResult && (
        <p className="text-sm text-green-600 bg-green-500/10 rounded-lg px-3 py-2">{logResult}</p>
      )}

      <div className="flex gap-2 flex-wrap">
        {logAction === 'confirming-old' && (
          <ConfirmInline
            icon={<Warning size={16} className="text-yellow-600" />}
            label={t.settings.logs.confirmClearOld}
            confirmLabel={t.settings.logs.confirm}
            cancelLabel={t.common.cancel}
            onConfirm={onClearOld}
            onCancel={() => setLogAction('idle')}
            confirmClass="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20"
          />
        )}
        {logAction === 'confirming-all' && (
          <ConfirmInline
            icon={<Warning size={16} className="text-red-600" />}
            label={t.settings.logs.confirmClearAll}
            confirmLabel={t.settings.logs.confirm}
            cancelLabel={t.common.cancel}
            onConfirm={onClearAll}
            onCancel={() => setLogAction('idle')}
            confirmClass="bg-red-500/10 text-red-600 hover:bg-red-500/20"
          />
        )}
        {logAction !== 'confirming-old' && logAction !== 'confirming-all' && (
          <>
            <ClearButton
              label={t.settings.logs.clearOld}
              disabled={logAction === 'clearing' || !hasFiles}
              onClick={() => setLogAction('confirming-old')}
            />
            <ClearButton
              label={t.settings.logs.clearAll}
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
  icon, label, confirmLabel, cancelLabel, onConfirm, onCancel, confirmClass,
}: {
  icon: React.ReactNode;
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-sm">{label}</span>
      <button onClick={onConfirm} className={`text-xs px-2 py-1 rounded ${confirmClass}`}>{confirmLabel}</button>
      <button onClick={onCancel} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">{cancelLabel}</button>
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
