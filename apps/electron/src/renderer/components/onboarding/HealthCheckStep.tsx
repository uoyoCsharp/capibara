import { useState, useCallback } from 'react';
import {
  CheckCircle,
  WarningCircle,
  ArrowRight,
  ArrowClockwise,
  Copy,
  Check,
  CircleNotch,
} from '@phosphor-icons/react';
import { useT } from '../../hooks-v2/use-locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;
interface DepCheckItem { ok: boolean; version: string | null }
interface SystemCheckResult { nodejs: DepCheckItem; claudeCli: DepCheckItem; network: DepCheckItem }
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import logoImg from '../../assets/logo.png';

interface HealthCheckStepProps {
  onContinue: () => void;
}

type CheckState = 'idle' | 'checking' | 'done';

export function HealthCheckStep({ onContinue }: HealthCheckStepProps) {
  const t = useT();
  const [state, setState] = useState<CheckState>('idle');
  const [result, setResult] = useState<SystemCheckResult | null>(null);
  const [copied, setCopied] = useState(false);

  const runCheck = useCallback(async () => {
    setState('checking');
    try {
      const res = await api().checkSystemDeps();
      if (res.ok) {
        setResult(res.data);
      } else {
        setResult({
          nodejs: { ok: false, version: null },
          claudeCli: { ok: false, version: null },
          network: { ok: false, version: null },
        });
      }
    } catch {
      setResult({
        nodejs: { ok: false, version: null },
        claudeCli: { ok: false, version: null },
        network: { ok: false, version: null },
      });
    }
    setState('done');
  }, []);

  // Auto-run on first render
  useState(() => { runCheck(); });

  const allPassed = result?.nodejs.ok && result?.claudeCli.ok && result?.network.ok;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(t.onboarding.installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-lg space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <img src={logoImg} alt="Capibara" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="text-2xl font-bold text-foreground">{t.onboarding.healthCheck}</h1>
          <p className="text-sm text-muted-foreground">{t.onboarding.healthCheckDesc}</p>
        </div>

        {/* Check Items */}
        <div className="space-y-3">
          <CheckRow
            label={t.onboarding.nodejs}
            item={result?.nodejs ?? null}
            checking={state === 'checking'}
            okLabel={t.onboarding.installed}
            failLabel={t.onboarding.notInstalled}
          />
          <CheckRow
            label={t.onboarding.claudeCli}
            item={result?.claudeCli ?? null}
            checking={state === 'checking'}
            okLabel={t.onboarding.installed}
            failLabel={t.onboarding.notInstalled}
          />
          <CheckRow
            label={t.onboarding.network}
            item={result?.network ?? null}
            checking={state === 'checking'}
            okLabel={t.onboarding.connected}
            failLabel={t.onboarding.disconnected}
          />
        </div>

        {/* Claude CLI install hint */}
        {state === 'done' && result && !result.claudeCli.ok && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
              Claude Code CLI is required for AI agent execution.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono text-foreground select-all">
                {t.onboarding.installCommand}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span className="ml-1">{copied ? t.onboarding.copied : ''}</span>
              </Button>
            </div>
          </div>
        )}

        {/* Status message */}
        {state === 'done' && allPassed && (
          <p className="text-center text-sm font-medium text-green-600 dark:text-green-400">
            {t.onboarding.allPassed}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          {state === 'done' && !allPassed && (
            <Button variant="ghost" size="sm" onClick={runCheck}>
              <ArrowClockwise size={16} className="mr-1.5" />
              {t.onboarding.retryCheck}
            </Button>
          )}
          <div className="flex-1" />
          {state === 'done' && (
            <Button onClick={onContinue}>
              {allPassed ? t.onboarding.continueNext : t.onboarding.continueAnyway}
              <ArrowRight size={16} className="ml-1.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Individual check row ────────────────────────────── */

function CheckRow({
  label,
  item,
  checking,
  okLabel,
  failLabel,
}: {
  label: string;
  item: DepCheckItem | null;
  checking: boolean;
  okLabel: string;
  failLabel: string;
}) {
  const isChecking = checking || item === null;
  const passed = item?.ok ?? false;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
        isChecking && 'border-border bg-muted/30',
        !isChecking && passed && 'border-green-500/30 bg-green-500/5',
        !isChecking && !passed && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      {isChecking ? (
        <CircleNotch size={20} className="animate-spin text-muted-foreground" />
      ) : passed ? (
        <CheckCircle size={20} weight="fill" className="text-green-500" />
      ) : (
        <WarningCircle size={20} weight="fill" className="text-amber-500" />
      )}
      <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
      {!isChecking && (
        <span className={cn('text-xs', passed ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400')}>
          {passed ? `${okLabel}${item?.version ? ` (${item.version})` : ''}` : failLabel}
        </span>
      )}
    </div>
  );
}
