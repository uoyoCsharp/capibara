import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, updateSettingSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { ISettingsRepository } from '@main/core/interfaces/i-settings.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import { isSupportedLocale, DEFAULT_LOCALE } from '@shared/locale/index.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerSettingsHandlers(
  settingsRepo: ISettingsRepository,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getSetting, async (_event, key: unknown) => {
    try {
      if (typeof key !== 'string' || !key) {
        return fail('VALIDATION_ERROR', 'key must be a non-empty string');
      }
      const value = await settingsRepo.get(key);
      return ok(value);
    } catch (err) {
      logger.error('Failed to get setting', { error: String(err) });
      return fail('INTERNAL', 'Failed to get setting');
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateSetting, async (_event, input: unknown) => {
    try {
      const parsed = updateSettingSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      await settingsRepo.set(parsed.data.key, parsed.data.value);

      // Broadcast locale changes to all renderer windows
      if (parsed.data.key === 'locale') {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC_CHANNELS.rendererEvent, {
            type: 'settings:locale-changed',
            locale: parsed.data.value,
          });
        }
      }

      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to update setting', { error: String(err) });
      return fail('INTERNAL', 'Failed to update setting');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getLocale, async () => {
    try {
      const locale = await settingsRepo.get('locale');
      if (locale && isSupportedLocale(locale)) {
        return ok(locale);
      }
      return ok(DEFAULT_LOCALE);
    } catch (err) {
      logger.error('Failed to get locale', { error: String(err) });
      return ok(DEFAULT_LOCALE);
    }
  });
}
