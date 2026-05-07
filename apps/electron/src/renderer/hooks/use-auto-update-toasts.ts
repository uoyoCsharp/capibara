import { useEffect } from 'react';
import { toast } from '../store/toast.store';
import { useT } from './use-locale';

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * Surface auto-update lifecycle events to the user via toasts.
 * Errors are intentionally swallowed at the UI layer — they live in the
 * electron-log file under userData/logs/main.log for diagnosis.
 */
export function useAutoUpdateToasts(): void {
  const t = useT();

  useEffect(() => {
    const unsub = window.capibara.onUpdateEvent((event) => {
      if (event.channel === 'available') {
        const version = readString(event.payload, 'version');
        const message = version
          ? t.autoUpdate.availableWithVersion.replace('{version}', version)
          : t.autoUpdate.availableNoVersion;
        toast.info(message);
      } else if (event.channel === 'downloaded') {
        toast.success(t.autoUpdate.readyToInstall);
      }
    });
    return unsub;
  }, [t]);
}
