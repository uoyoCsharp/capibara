import { useEffect, useRef } from 'react';
import { Warning } from '@phosphor-icons/react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const confirmColors =
    variant === 'danger'
      ? 'bg-danger text-text-inverse hover:opacity-90'
      : 'bg-warning text-text-inverse hover:opacity-90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card rounded-[var(--card-radius)] shadow-modal p-6 max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className={`shrink-0 rounded-full p-2 ${variant === 'danger' ? 'bg-danger-subtle' : 'bg-warning-subtle'}`}>
            <Warning size={20} weight="fill" className={variant === 'danger' ? 'text-danger' : 'text-warning'} />
          </div>
          <div>
            <h4 className="font-semibold text-text-primary">{title}</h4>
            <p className="text-sm text-text-secondary mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            ref={cancelRef}
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-sunken transition-colors"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${confirmColors}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
