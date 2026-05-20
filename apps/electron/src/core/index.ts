// Capibara Core — Electron main process entry point
// This stub will be wired as the Electron main entry once the legacy
// src/main/index.ts is retired. For now it validates structure compiles.

import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import { bootstrap, shutdown, getEventBroadcaster } from './bootstrap/composition-root';
import { registerAutoUpdater } from './infrastructure/auto-updater';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  const broadcaster = getEventBroadcaster();
  broadcaster.setSendFn((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capibara:desktop-event', event);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  registerAutoUpdater(mainWindow);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
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

let isShuttingDown = false;
app.on('before-quit', (e) => {
  if (isShuttingDown) return;
  e.preventDefault();
  isShuttingDown = true;
  shutdown().finally(() => app.exit(0));
});
