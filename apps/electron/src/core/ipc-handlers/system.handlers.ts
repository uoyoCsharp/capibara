import { ipcMain } from 'electron';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerSystemHandlers(
  connection: ISqliteConnection,
): void {
  ipcMain.handle('capibara:settings:get', async (_ev, key: string) => {
    try {
      const row = connection.getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return ok(row?.value ?? null);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:settings:set', async (_ev, key: string, value: string) => {
    try {
      connection.getDb()
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(key, value);
      return ok(null);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:system:health', async () => {
    return ok({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
