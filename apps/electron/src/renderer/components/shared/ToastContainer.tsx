import { X, CheckCircle, WarningCircle, Info, Warning } from '@phosphor-icons/react';
import { useToastStore, type ToastType } from '../../store/toast.store';
import { cn } from '../../lib/utils';

const ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: WarningCircle,
  warning: Warning,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  success: 'border-l-green-500 bg-green-500/10 text-green-600 dark:text-green-400',
  error: 'border-l-destructive bg-destructive/10 text-destructive',
  warning: 'border-l-yellow-500 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  info: 'border-l-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border-l-4 px-4 py-3 shadow-md bg-card',
              COLORS[t.type],
            )}
            style={{ animation: 'toast-enter 200ms ease-out' }}
          >
            <Icon size={18} weight="fill" className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm leading-snug">{t.message}</p>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  className="mt-1.5 text-xs font-medium underline underline-offset-2 hover:no-underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
