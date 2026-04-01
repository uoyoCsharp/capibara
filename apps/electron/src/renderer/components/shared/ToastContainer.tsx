import { X, CheckCircle, WarningCircle, Info, Warning } from '@phosphor-icons/react';
import { useToastStore, type ToastType } from '../../store/toast.store';

const ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: WarningCircle,
  warning: Warning,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  success: 'border-l-success bg-success-subtle text-success-text',
  error: 'border-l-danger bg-danger-subtle text-danger-text',
  warning: 'border-l-warning bg-warning-subtle text-warning-text',
  info: 'border-l-info bg-info-subtle text-info-text',
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
            className={`flex items-start gap-2.5 rounded-lg border-l-4 px-4 py-3 shadow-md ${COLORS[t.type]}`}
            style={{ animation: 'toast-enter 200ms ease-out' }}
          >
            <Icon size={18} weight="fill" className="shrink-0 mt-0.5" />
            <p className="text-sm flex-1 leading-snug">{t.message}</p>
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
