'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const { openDatabase } = require('./db.cjs');
const { createServices, PosError } = require('./services/index.cjs');
const { createLicenseStore } = require('./license.cjs');
const { createUpdater } = require('./updater.cjs');

// Only these namespaces are reachable from the renderer.
const EXPOSED = ['settings', 'auth', 'users', 'categories', 'products', 'tables', 'shifts', 'orders', 'suppliers', 'purchases', 'expenses', 'customers', 'reports', 'auditLog', 'commissions'];

// Lets a portable install or tests keep data in a chosen folder.
if (process.env.INNOFORGE_POS_DATA_DIR) app.setPath('userData', path.resolve(process.env.INNOFORGE_POS_DATA_DIR));

let db;
let services;
let mainWindow;
let licenses;
let license;
let updater;

const dbFile = () => path.join(app.getPath('userData'), 'innoforge-pos.db');

// Installed builds are locked to one computer; running from source (npm start) is not,
// unless INNOFORGE_POS_FORCE_LICENSE=1 is set to test the activation flow.
const licenseRequired = () => app.isPackaged || process.env.INNOFORGE_POS_FORCE_LICENSE === '1';
// Before activation the UI may only read settings (language, business name).
const ALLOWED_UNLICENSED = new Set(['settings.get', 'settings.setLanguage']);

function licenseOk() {
  if (!licenseRequired()) return true;
  if (!license?.valid) return false;
  if (license.expires && Date.now() > Date.parse(license.expires)) license = licenses.status();
  return license.valid;
}

function boot() {
  db = openDatabase(dbFile());
  services = createServices(db);
  licenses = createLicenseStore({
    file: path.join(app.getPath('userData'), 'license.json'),
    publicKeyPem: require('./license-public.cjs'),
  });
  license = licenses.status();
  autoBackup('daily');
  updater = createUpdater({
    publicKeyPem: require('./license-public.cjs'),
    onState: (state) => mainWindow?.webContents.send('pos:update-state', state),
  });
}

// Keeps rolling copies of the database in userData/backups: one per day (last 14),
// plus one right before every update is installed.
function autoBackup(kind, label = new Date().toLocaleDateString('en-CA')) {
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${kind}-${label}.db`);
    if (kind === 'daily' && fs.existsSync(file)) return;
    fs.rmSync(file, { force: true });
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const daily = fs.readdirSync(dir).filter((f) => f.startsWith('daily-')).sort();
    for (const old of daily.slice(0, Math.max(0, daily.length - 14))) fs.rmSync(path.join(dir, old), { force: true });
  } catch (err) {
    console.error('auto backup failed', err);
  }
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
      devTools: !app.isPackaged,
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
    if (!ALLOWED_UNLICENSED.has(`${ns}.${method}`) && !licenseOk()) throw new PosError('LICENSE_REQUIRED');
    return ok(target[method](arg));
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('pos:license', () => ok({ ...license, required: licenseRequired(), valid: licenseOk() }));

ipcMain.handle('pos:activate', (_e, key) => {
  const result = licenses.activate(key);
  if (result.valid) {
    license = result;
    services.audit('license_activate', { userId: null, details: { customer: result.customer, expires: result.expires } });
  }
  return result.valid ? ok({ ...result, required: licenseRequired() }) : fail(new PosError(`LICENSE_${result.reason}`));
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
    services.requirePerm('backup');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `innoforge-pos-backup-${stamp}.db`,
      filters: [{ name: 'Database', extensions: ['db'] }],
    });
    if (canceled || !filePath) return ok(null);
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
    services.audit('backup', { details: { file: path.basename(filePath) } });
    return ok(filePath);
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('pos:restore', async () => {
  try {
    services.requirePerm('backup');
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
    services.audit('restore', { details: { file: path.basename(filePaths[0]) } });
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

ipcMain.handle('pos:version', () => ok(app.getVersion()));
ipcMain.handle('pos:updateState', () => ok(updater.state()));
ipcMain.handle('pos:updateCheck', async () => ok(await updater.check()));
ipcMain.handle('pos:updateInstall', () => {
  if (updater.state().status !== 'ready') return fail(new PosError('NO_UPDATE'));
  autoBackup('pre-update', updater.state().version);
  return ok(updater.install());
});

ipcMain.handle('pos:copy', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return ok(true);
});

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
