import { ipcMain, dialog, shell } from 'electron';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerSystemHandlers(
  connection: ISqliteConnection,
): void {
  // Scheduler control (execution pause/resume) — stub for now
  ipcMain.handle('capibara:scheduler:get-state', async () => {
    return ok({ paused: false });
  });

  ipcMain.handle('capibara:scheduler:pause', async () => {
    return ok({ cancelledRunCount: 0 });
  });

  ipcMain.handle('capibara:scheduler:resume', async () => {
    return ok(null);
  });

  // Dialogs
  ipcMain.handle('capibara:dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return ok(result.filePaths[0]);
  });

  ipcMain.handle('capibara:shell:open-folder', async (_ev, folderPath: string) => {
    try { await shell.openPath(folderPath); return ok(null); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  // Legacy snapshot — returns org list as snapshot
  ipcMain.handle('capibara:snapshot:load', async () => {
    try {
      const rows = connection.getDb()
        .prepare('SELECT * FROM organizations ORDER BY created_at DESC')
        .all();
      return ok({ organizations: rows, currentOrgId: (rows[0] as { id: string } | undefined)?.id ?? null });
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  // Locale
  ipcMain.handle('capibara:settings:get-locale', async () => {
    try {
      const row = connection.getDb()
        .prepare("SELECT value FROM settings WHERE key = 'locale'")
        .get() as { value: string } | undefined;
      return ok(row?.value ?? 'en-US');
    } catch { return ok('en-US'); }
  });

  // System checks — stub
  ipcMain.handle('capibara:system:check-deps', async () => {
    return ok({ nodejs: { ok: true, version: process.version }, claudeCli: { ok: true, version: null }, network: { ok: true, version: null } });
  });
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
