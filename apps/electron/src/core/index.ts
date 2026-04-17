// Capibara Core — Electron main process entry point
// This stub will be wired as the Electron main entry once the legacy
// src/main/index.ts is retired. For now it validates structure compiles.

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { bootstrap, shutdown, getEventBroadcaster } from './bootstrap/composition-root';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
    },
  });

  const broadcaster = getEventBroadcaster();
  broadcaster.setSendFn((event) => {
    mainWindow?.webContents.send('capibara:desktop-event', event);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await bootstrap();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await shutdown();
});
