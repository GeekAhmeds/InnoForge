'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { openDatabase } = require('./db.cjs');
const { createServices, PosError } = require('./services/index.cjs');

// Only these namespaces are reachable from the renderer.
const EXPOSED = ['settings', 'auth', 'users', 'categories', 'products', 'tables', 'shifts', 'orders', 'reports'];

// Lets a portable install or tests keep data in a chosen folder.
if (process.env.INNOFORGE_POS_DATA_DIR) app.setPath('userData', path.resolve(process.env.INNOFORGE_POS_DATA_DIR));

let db;
let services;
let mainWindow;

const dbFile = () => path.join(app.getPath('userData'), 'innoforge-pos.db');

function boot() {
  db = openDatabase(dbFile());
  services = createServices(db);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f4f5f7',
    title: 'InnoForge POS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.removeMenu();

  // Everything is local: block navigation away from the app and open links externally.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env.VITE_DEV_SERVER_URL || '\0')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') mainWindow.setFullScreen(!mainWindow.isFullScreen());
    if (input.key === 'F12' && !app.isPackaged) mainWindow.webContents.toggleDevTools();
  });

  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

const ok = (data) => ({ ok: true, data });
const fail = (err) => {
  if (!(err instanceof PosError)) console.error(err);
  return { ok: false, code: err.code || 'ERROR', message: err.message };
};

ipcMain.handle('pos:call', (_e, ns, method, arg) => {
  try {
    const target = EXPOSED.includes(ns) ? services[ns] : null;
    if (!target || typeof target[method] !== 'function') throw new PosError('UNKNOWN_METHOD', `${ns}.${method}`);
    return ok(target[method](arg));
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('pos:printers', async () => {
  try {
    return ok((await mainWindow.webContents.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: p.isDefault })));
  } catch (err) {
    return fail(err);
  }
});

// Prints a self-contained HTML document (receipt, kitchen ticket, shift report).
ipcMain.handle('pos:print', async (_e, { html, printer = '', silent = false } = {}) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const result = await new Promise((resolve) => {
      win.webContents.print(
        { silent: !!silent, deviceName: printer || undefined, printBackground: true, margins: { marginType: 'none' } },
        (success, reason) => resolve({ success, reason }),
      );
    });
    return result.success || result.reason === 'cancelled' ? ok(result) : fail(new PosError('PRINT_FAILED', result.reason));
  } catch (err) {
    return fail(err);
  } finally {
    win.destroy();
  }
});

ipcMain.handle('pos:backup', async () => {
  try {
    services.requireAdmin();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `innoforge-pos-backup-${stamp}.db`,
      filters: [{ name: 'Database', extensions: ['db'] }],
    });
    if (canceled || !filePath) return ok(null);
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
    return ok(filePath);
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('pos:restore', async () => {
  try {
    services.requireAdmin();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Database', extensions: ['db'] }],
    });
    if (canceled || !filePaths?.length) return ok(false);
    // Validate before replacing the live database.
    const { DatabaseSync } = require('node:sqlite');
    const probe = new DatabaseSync(filePaths[0], { readOnly: true });
    try {
      probe.prepare('SELECT COUNT(*) FROM orders').get();
    } catch {
      throw new PosError('INVALID_BACKUP');
    } finally {
      probe.close();
    }
    db.close();
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbFile() + suffix, { force: true });
    fs.copyFileSync(filePaths[0], dbFile());
    app.relaunch();
    app.exit(0);
    return ok(true);
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('pos:dataPath', () => ok(dbFile()));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    boot();
    createWindow();
  });
  app.on('window-all-closed', () => {
    try { db?.close(); } catch { /* already closed */ }
    app.quit();
  });
}
