import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle,
  WarningCircle,
  ArrowRight,
  ArrowClockwise,
  CircleNotch,
} from '@phosphor-icons/react';
import { useT } from '../../hooks/use-locale';

const api = () => window.capibara;

interface DepCheckItem { ok: boolean; version: string | null }
interface SystemCheckResult { nodejs: DepCheckItem; acpAgent: DepCheckItem; network: DepCheckItem }

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

  const runCheck = useCallback(async () => {
    setState('checking');
    const fallback: SystemCheckResult = {
      nodejs: { ok: false, version: null },
      acpAgent: { ok: false, version: null },
      network: { ok: false, version: null },
    };
    try {
      const res = await api().checkSystemDeps();
      if (res.ok) {
        setResult(res.data as SystemCheckResult);
      } else {
        setResult(fallback);
      }
    } catch {
      setResult(fallback);
    }
    setState('done');
  }, []);

  useEffect(() => { void runCheck(); }, [runCheck]);

  const allPassed = result?.nodejs.ok && result?.acpAgent.ok && result?.network.ok;

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
            label={t.onboarding.acpAgent}
            item={result?.acpAgent ?? null}
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
