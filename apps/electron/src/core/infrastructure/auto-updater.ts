import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import log from 'electron-log';
import { getMessages, isSupportedLocale, DEFAULT_LOCALE } from '@shared/locale/index.js';
import type { SupportedLocale } from '@shared/locale/types.js';
import { getSqliteConnection } from '../bootstrap/composition-root';

type UpdateChannel =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'download-progress'
  | 'downloaded'
  | 'error';

type UpdatePayload = UpdateInfo | ProgressInfo | { message: string } | undefined;

const INITIAL_CHECK_DELAY_MS = 5_000;
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function broadcast(win: BrowserWindow, channel: UpdateChannel, payload?: UpdatePayload): void {
  if (win.isDestroyed()) return;
  win.webContents.send('capibara:auto-update', { channel, payload });
}

function getCurrentLocale(): SupportedLocale {
  try {
    const row = getSqliteConnection()
      .getDb()
      .prepare("SELECT value FROM settings WHERE key = 'locale'")
      .get() as { value: string } | undefined;
    const raw = row?.value;
    return raw && isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch (err) {
    log.warn('[auto-updater] failed to read locale setting, falling back to default', err);
    return DEFAULT_LOCALE;
  }
}

export function registerAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    log.info('[auto-updater] skipped: app is not packaged');
    return;
  }

  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => broadcast(mainWindow, 'checking'));
  autoUpdater.on('update-available', (info) => broadcast(mainWindow, 'available', info));
  autoUpdater.on('update-not-available', (info) => broadcast(mainWindow, 'not-available', info));
  autoUpdater.on('download-progress', (p) => broadcast(mainWindow, 'download-progress', p));
  autoUpdater.on('error', (err) => {
    log.error('[auto-updater] error', err);
    broadcast(mainWindow, 'error', { message: err.message });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    broadcast(mainWindow, 'downloaded', info);
    const t = getMessages(getCurrentLocale()).autoUpdate;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: [t.restartNow, t.later],
      defaultId: 0,
      cancelId: 1,
      title: t.dialogTitle,
      message: t.dialogMessage.replace('{version}', info.version),
      detail: t.dialogDetail,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  setTimeout(() => {
    autoUpdater
      .checkForUpdates()
      .catch((err) => log.error('[auto-updater] initial check failed', err));
  }, INITIAL_CHECK_DELAY_MS);

  setInterval(() => {
    autoUpdater
      .checkForUpdates()
      .catch((err) => log.error('[auto-updater] periodic check failed', err));
  }, PERIODIC_CHECK_INTERVAL_MS);
}
