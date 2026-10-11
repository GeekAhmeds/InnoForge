'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const { openDatabase } = require('./db.cjs');
const { createServices, PosError } = require('./services/index.cjs');
const { createLicenseStore } = require('./license.cjs');
const { entitlements, FULL } = require('./editions.cjs');
const { createUpdater } = require('./updater.cjs');
const excel = require('./excel.cjs');
const { createKdsServer } = require('./kds-server.cjs');
const { sendRaw, drawerKick } = require('./rawprint.cjs');
const { EXPOSED } = require('./exposed.cjs');
const { exportSheets } = require('./export-sheets.cjs');
const { createDeviceStore } = require('./device.cjs');
const { createRemote } = require('./remote.cjs');
const { createLanServer } = require('./lan-server.cjs');
const { createEtaSubmitter } = require('./eta-submitter.cjs');


// Lets a portable install or tests keep data in a chosen folder.
if (process.env.INNOFORGE_POS_DATA_DIR) app.setPath('userData', path.resolve(process.env.INNOFORGE_POS_DATA_DIR));

let db;
let services; // this computer's own services (not in client mode)
let devices; // device.json: standalone / server / client
let remote = null; // client mode: the main computer
let remoteInfo = null; // client mode: what the main computer said last (license, version)
let lanServer = null; // server mode
let etaSubmitter = null; // e-invoices go out from the computer that holds the data
let mainWindow;
let licenses;
let license;
let updater;
let kdsServer;
let serialListOnly = false;
let customerWindow;
// What the customer-facing screen shows (sent by the till on every cart change).
let customerState = { mode: 'idle' };
let kdsWindow;

const dbFile = () => path.join(app.getPath('userData'), 'innoforge-pos.db');

// Installed builds are locked to one computer; running from source (npm start) is not,
// unless INNOFORGE_POS_FORCE_LICENSE=1 is set to test the activation flow.
const licenseRequired = () => app.isPackaged || process.env.INNOFORGE_POS_FORCE_LICENSE === '1';
// Before activation the UI may only read settings (language, business name).
const ALLOWED_UNLICENSED = new Set(['settings.get', 'settings.setLanguage']);

const clientMode = () => !!remote;

function licenseOk() {
  // A connected computer runs on the main computer's license, which checks every call.
  if (clientMode()) return true;
  if (!licenseRequired()) return true;
  if (!license?.valid) return false;
  if (license.expires && Date.now() > Date.parse(license.expires)) license = licenses.status();
  return license.valid;
}

// What this copy may use. From source (not packaged) everything is on, unless
// INNOFORGE_POS_EDITION=basic|market|… is set to try an edition.
function currentEntitlements() {
  if (clientMode()) {
    const e = remoteInfo?.entitlements;
    return e ? { edition: e.edition, features: new Set(e.features), addons: e.addons, limits: e.limits } : FULL;
  }
  if (!licenseRequired()) {
    const ed = !app.isPackaged && process.env.INNOFORGE_POS_EDITION;
    return ed ? entitlements({ edition: ed }) : FULL;
  }
  if (!license?.valid) return FULL; // nothing runs without a valid license anyway
  return { edition: license.edition, features: new Set(license.features), addons: license.addons, limits: license.limits };
}
const entitlementsJSON = () => { const e = currentEntitlements(); return { edition: e.edition, features: [...e.features], addons: e.addons, limits: e.limits }; };

// Every service call made by the main process goes through `svc`: to this computer's
// services, or to the main computer in client mode. Always returns a promise.
const TOP_LEVEL = new Set(['requirePerm', 'audit', 'can']);
function callService(pathName, args = []) {
  if (remote) return remote.call(pathName, args);
  return new Promise((resolve) => {
    const [ns, method] = pathName.split('.');
    const owner = method ? services[ns] : services;
    const fn = owner?.[method || ns];
    if (typeof fn !== 'function') throw new PosError('UNKNOWN_METHOD', pathName);
    resolve(fn.apply(owner, args));
  });
}
const svc = new Proxy({}, {
  get: (_t, ns) => (TOP_LEVEL.has(ns)
    ? (...args) => callService(ns, args)
    : new Proxy({}, { get: (_u, method) => (...args) => callService(`${ns}.${method}`, args) })),
});

async function refreshRemoteInfo() {
  try { remoteInfo = await remote.info(); } catch { remoteInfo = null; }
  return remoteInfo;
}

function boot() {
  devices = createDeviceStore(path.join(app.getPath('userData'), 'device.json'));
  const dev = devices.load();
  licenses = createLicenseStore({
    file: path.join(app.getPath('userData'), 'license.json'),
    publicKeyPem: require('./license-public.cjs'),
  });
  license = licenses.status();
  if (dev.mode === 'client' && dev.server.host) {
    // No local data: everything lives on the main computer.
    remote = createRemote({ server: dev.server, deviceId: dev.id, deviceName: dev.name });
    refreshRemoteInfo().then(() => remote.reset()).catch(() => {});
    setInterval(refreshRemoteInfo, 60000).unref?.();
  } else {
    db = openDatabase(dbFile());
    services = createServices(db, { entitlements: currentEntitlements });
    db.prepare("UPDATE devices SET name = ? WHERE id = 'local' AND name = ''").run(dev.name);
    autoBackup('daily');
    if (dev.mode === 'server') startLanServer();
    etaSubmitter = createEtaSubmitter({ queue: services.etaQueue, log: (...a) => console.error(...a) });
    etaSubmitter.start();
    setTimeout(() => { if (licenseOk() && services.settings.get().eta_auto) etaSubmitter.run(); }, 20000).unref?.();
  }
  kdsServer = createKdsServer({ services: svc, customerState: () => customerState });
  kdsServer.start().catch((err) => console.error('kitchen screen server', err));
  updater = createUpdater({
    publicKeyPem: require('./license-public.cjs'),
    onState: (state) => mainWindow?.webContents.send('pos:update-state', state),
  });
}

function startLanServer() {
  lanServer ??= createLanServer({
    local: services,
    makeServices: (deviceId) => createServices(db, { entitlements: currentEntitlements, deviceId }),
    getConfig: () => devices.load(),
    licenseOk,
    info: () => ({ version: app.getVersion(), business_name: services.settings.get().business_name, server_name: devices.load().name }),
    onCall: (ns, method, arg) => {
      if (ns === 'settings' && (method === 'newKdsKey' || (method === 'save' && arg && ('kds_lan' in arg || 'kds_port' in arg)))) kdsServer.start().catch(() => {});
    },
  });
  return lanServer.start();
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
  // Serial scales (Web Serial). The port is chosen here, by the name saved in Settings → Devices;
  // 'list only' requests just report the ports so the settings screen can show them.
  const ses = mainWindow.webContents.session;
  ses.on('select-serial-port', async (event, portList, _wc, callback) => {
    event.preventDefault();
    const ports = portList.map((p) => ({ portId: p.portId, portName: p.portName, displayName: p.displayName || p.portName }));
    mainWindow.webContents.send('pos:serial-ports', ports);
    if (serialListOnly) { serialListOnly = false; callback(''); return; }
    const wanted = await svc.settings.get().then((s) => s.scale_port, () => '');
    const pick = portList.find((p) => p.portName === wanted || p.portId === wanted) || (!wanted && portList.length === 1 ? portList[0] : null);
    callback(pick ? pick.portId : '');
  });
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');

  // The kitchen screen belongs to the till: closing the till closes it too.
  mainWindow.on('closed', () => {
    if (kdsWindow && !kdsWindow.isDestroyed()) kdsWindow.close();
    if (customerWindow && !customerWindow.isDestroyed()) customerWindow.close();
  });

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

ipcMain.handle('pos:call', async (_e, ns, method, arg) => {
  try {
    if (!EXPOSED.includes(ns) || typeof method !== 'string' || method.includes('.')) throw new PosError('UNKNOWN_METHOD', `${ns}.${method}`);
    if (!remote && typeof services[ns]?.[method] !== 'function') throw new PosError('UNKNOWN_METHOD', `${ns}.${method}`);
    if (!ALLOWED_UNLICENSED.has(`${ns}.${method}`) && !licenseOk()) throw new PosError('LICENSE_REQUIRED');
    const result = await callService(`${ns}.${method}`, [arg]);
    // Kitchen screen settings take effect right away.
    if (ns === 'settings' && (method === 'newKdsKey' || (method === 'save' && arg && ('kds_lan' in arg || 'kds_port' in arg)))) {
      await kdsServer.start();
    }
    // A blocked computer is cut off at once.
    if (ns === 'devices' && method === 'save' && arg && !arg.active) lanServer?.forget(String(arg.id));
    return ok(result);
  } catch (err) {
    return fail(err);
  }
});

// Cash drawer wired to the receipt printer: an ESC/POS pulse sent as a raw print job.
// manual = the "open drawer" button (needs the open_drawer permission and is logged).
ipcMain.handle('pos:openDrawer', async (_e, { manual = false, approval = null } = {}) => {
  try {
    if (!licenseOk()) throw new PosError('LICENSE_REQUIRED');
    if (manual) await svc.drawer.authorize({ approval });
    const s = await svc.settings.get();
    let printer = s.printer_name;
    if (!printer) printer = (await mainWindow.webContents.getPrintersAsync()).find((p) => p.isDefault)?.name || '';
    await sendRaw(printer, drawerKick(s.drawer_pin));
    return ok(true);
  } catch (err) {
    return fail(err instanceof PosError ? err : new PosError('DRAWER_FAILED', err.message));
  }
});

ipcMain.handle('pos:display', (_e, state) => { customerState = state && typeof state === 'object' ? state : { mode: 'idle' }; return ok(true); });

ipcMain.handle('pos:openCustomerDisplay', () => {
  if (!licenseOk()) return fail(new PosError('LICENSE_REQUIRED'));
  const info = kdsServer.info();
  if (!info.running) return fail(new PosError('KDS_NOT_RUNNING', info.error || ''));
  const url = info.localUrl.replace('/kds?', '/customer?');
  if (customerWindow && !customerWindow.isDestroyed()) { customerWindow.focus(); return ok(true); }
  const { screen } = require('electron');
  const other = screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id);
  customerWindow = new BrowserWindow({
    width: 1024, height: 700, backgroundColor: '#0b1220', title: 'InnoForge — Customer', autoHideMenuBar: true,
    ...(other ? { x: other.bounds.x, y: other.bounds.y } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  customerWindow.removeMenu();
  customerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  customerWindow.on('closed', () => { customerWindow = null; });
  if (other) customerWindow.once('ready-to-show', () => customerWindow.setFullScreen(true));
  customerWindow.loadURL(url);
  return ok(true);
});

ipcMain.handle('pos:serialListOnly', () => { serialListOnly = true; return ok(true); });

// Kitchen display: where it can be opened, and a window for a screen on this computer.
ipcMain.handle('pos:kdsInfo', () => {
  if (!licenseOk()) return fail(new PosError('LICENSE_REQUIRED'));
  return ok(kdsServer.info());
});

ipcMain.handle('pos:openKds', (_e, { station = '' } = {}) => {
  if (!licenseOk()) return fail(new PosError('LICENSE_REQUIRED'));
  const info = kdsServer.info();
  if (!info.running) return fail(new PosError('KDS_NOT_RUNNING', info.error || ''));
  const url = `${info.localUrl}${station ? `&station=${encodeURIComponent(station)}` : ''}`;
  if (kdsWindow && !kdsWindow.isDestroyed()) {
    kdsWindow.loadURL(url);
    kdsWindow.focus();
    return ok(true);
  }
  // Prefer a second monitor (the one in the kitchen) when there is one.
  const { screen } = require('electron');
  const other = screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id);
  kdsWindow = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0b1220', title: 'InnoForge — Kitchen', autoHideMenuBar: true,
    ...(other ? { x: other.bounds.x, y: other.bounds.y } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  kdsWindow.removeMenu();
  kdsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  kdsWindow.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(info.localUrl.split('/kds')[0])) e.preventDefault(); });
  kdsWindow.on('closed', () => { kdsWindow = null; });
  if (other) kdsWindow.once('ready-to-show', () => kdsWindow.setFullScreen(true));
  kdsWindow.loadURL(url);
  return ok(true);
});

ipcMain.handle('pos:license', async () => {
  if (clientMode()) {
    await refreshRemoteInfo();
    const dev = devices.load();
    return ok({ ...entitlementsJSON(), required: false, valid: true, client: true, connected: !!remoteInfo, serverLicensed: !!remoteInfo?.licensed, server: `${dev.server.host}:${dev.server.port}`, machine: license?.machine });
  }
  return ok({ ...license, ...entitlementsJSON(), required: licenseRequired(), valid: licenseOk() });
});

ipcMain.handle('pos:activate', (_e, key) => {
  if (clientMode()) return fail(new PosError('CLIENT_MODE'));
  const result = licenses.activate(key);
  if (result.valid) {
    license = result;
    services?.audit('license_activate', { userId: null, details: { customer: result.customer, expires: result.expires, edition: result.edition } });
  }
  return result.valid ? ok({ ...result, ...entitlementsJSON(), required: licenseRequired() }) : fail(new PosError(`LICENSE_${result.reason}`));
});

// ---------- Several computers on one set of data ----------
// Settings → Network (and the activation screen): this computer's role, the main
// computer's address, the access key other computers need.
ipcMain.handle('pos:network', async () => {
  const dev = devices.load();
  const out = { id: dev.id, name: dev.name, mode: remote ? 'client' : dev.mode, server: { host: dev.server.host, port: dev.server.port } };
  if (remote) {
    await refreshRemoteInfo();
    out.remote = remoteInfo ? { connected: true, version: remoteInfo.version, business_name: remoteInfo.business_name, server_name: remoteInfo.server_name, licensed: remoteInfo.licensed } : { connected: false };
  } else {
    out.serve = { port: dev.serve.port, key: dev.serve.key, ...(lanServer?.state() || { running: false, addresses: [] }) };
  }
  out.version = app.getVersion();
  return ok(out);
});

// Changes to the network role need someone allowed to change settings — except on a
// fresh copy (setup or activation screen), which may join a main computer.
async function requireNetworkAdmin() {
  if (!remote && (!services.settings.get().setup_done || (licenseRequired() && !license?.valid))) return;
  await svc.requirePerm('settings');
}

ipcMain.handle('pos:networkServe', async (_e, { enabled, port, newKey = false, name } = {}) => {
  try {
    if (remote) throw new PosError('CLIENT_MODE');
    await requireNetworkAdmin();
    const dev = devices.load();
    const p = Number(port) || dev.serve.port;
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new PosError('BAD_PORT');
    devices.update({
      mode: enabled ? 'server' : 'standalone',
      name: name != null ? String(name).trim().slice(0, 60) : dev.name,
      serve: { port: p, key: newKey ? devices.newKey() : dev.serve.key },
    });
    if (enabled) await startLanServer(); else await lanServer?.stop();
    services.audit('network_update', { details: { mode: enabled ? 'server' : 'standalone', port: p, new_key: !!newKey } });
    return ok(lanServer?.state() || { running: false });
  } catch (err) {
    return fail(err);
  }
});

// Joins a main computer: checks the address and key first, then restarts as a client.
ipcMain.handle('pos:networkConnect', async (_e, { host, port, key, name } = {}) => {
  try {
    if (remote) throw new PosError('CLIENT_MODE');
    if (devices.load().mode === 'server') throw new PosError('SERVER_MODE');
    await requireNetworkAdmin();
    const dev = devices.load();
    const server = { host: String(host || '').trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''), port: Number(port) || 7790, key: String(key || '').trim() };
    if (!server.host || !server.key) throw new PosError('NAME_REQUIRED');
    const deviceName = String(name || dev.name).trim().slice(0, 60);
    const info = await createRemote({ server, deviceId: dev.id, deviceName }).info(8000);
    if (info.app !== 'innoforge-pos') throw new PosError('SERVER_OFFLINE');
    services?.audit('network_update', { details: { mode: 'client', server: `${server.host}:${server.port}` } });
    devices.update({ mode: 'client', name: deviceName, server });
    setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
    return ok(info);
  } catch (err) {
    return fail(err);
  }
});

// Back to working on this computer's own data.
ipcMain.handle('pos:networkDisconnect', async () => {
  try {
    if (!remote) throw new PosError('NOT_FOUND');
    // Anyone may leave a main computer that cannot be reached; otherwise it needs the permission.
    if (await refreshRemoteInfo()) await svc.requirePerm('settings');
    devices.update({ mode: 'standalone' });
    setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
    return ok(true);
  } catch (err) {
    return fail(err);
  }
});

// ---------- Egyptian e-invoice ----------
ipcMain.handle('pos:etaRun', async () => {
  try {
    if (remote) throw new PosError('CLIENT_MODE');
    if (!licenseOk()) throw new PosError('LICENSE_REQUIRED');
    services.requirePerm('reports');
    services.license.requireFeature('eta');
    return ok(await etaSubmitter.run());
  } catch (err) {
    return fail(err);
  }
});
ipcMain.handle('pos:etaTest', async () => {
  try {
    if (remote) throw new PosError('CLIENT_MODE');
    services.requirePerm('settings');
    services.license.requireFeature('eta');
    etaSubmitter.clearTokens();
    return ok({ ...(await etaSubmitter.test(services.deviceId)), last: etaSubmitter.state() });
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
    if (clientMode()) throw new PosError('CLIENT_MODE');
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
    if (clientMode()) throw new PosError('CLIENT_MODE');
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

ipcMain.handle('pos:dataPath', () => ok(clientMode() ? remote.base : dbFile()));

// ---------- Excel ----------
const xlsxFilter = [{ name: 'Excel', extensions: ['xlsx'] }];
const stampName = (base) => `${base}-${new Date().toLocaleDateString('en-CA')}.xlsx`;

ipcMain.handle('pos:excelTemplate', async (_e, kind) => {
  try {
    await svc.requirePerm('backup');
    await svc.license.requireFeature('excel');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: `innoforge-${kind}-template.xlsx`, filters: xlsxFilter });
    if (canceled || !filePath) return ok(null);
    await excel.writeTemplate(kind, filePath);
    return ok(filePath);
  } catch (err) {
    return fail(err);
  }
});

// Opens a sheet and returns its rows for preview; the renderer then calls importer.<kind>.
ipcMain.handle('pos:excelPick', async (_e, kind) => {
  try {
    await svc.requirePerm('backup');
    await svc.license.requireFeature('excel');
  } catch (err) {
    return fail(err);
  }
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv'] }] });
    if (canceled || !filePaths?.length) return ok(null);
    return ok({ file: path.basename(filePaths[0]), ...(await excel.parseFile(kind, filePaths[0])) });
  } catch (err) {
    return fail(new PosError('INVALID_EXCEL', err.message));
  }
});


ipcMain.handle('pos:excelExport', async (_e, { kind, ...params } = {}) => {
  try {
    // Checks permissions before asking where to save.
    const sheets = remote ? await remote.exportSheets(kind, params) : exportSheets(services, kind, params);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: stampName(`innoforge-${kind}`), filters: xlsxFilter });
    if (canceled || !filePath) return ok(null);
    await excel.writeSheets(filePath, sheets, (await svc.settings.get()).decimals ?? 2);
    await svc.audit('export', { details: { kind } });
    return ok(filePath);
  } catch (err) {
    return fail(err);
  }
});

// One report from the Reports page as a formatted Excel file. The numbers are re-read
// from the services (never trusted from the window); only the translated texts come from it.
ipcMain.handle('pos:reportExcel', async (_e, { id, from, to, labels } = {}) => {
  try {
    const report = await svc.reports.run({ id, from, to });
    const s = await svc.settings.get();
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), `${String(labels?.title || id).replace(/[\\/:*?"<>|]+/g, '-')} ${from || ''}${to && to !== from ? ` - ${to}` : ''}.xlsx`.replace(/\s+\.xlsx$/, '.xlsx')),
      filters: xlsxFilter,
    });
    if (canceled || !filePath) return ok(null);
    await excel.writeReport(filePath, report, { labels: labels || { title: id, columns: {} }, business: s.business_name, decimals: s.decimals ?? 2, currency: s.currency, rtl: s.language !== 'en' });
    await svc.audit('export', { details: { kind: `report:${id}` } });
    shell.showItemInFolder(filePath);
    return ok(filePath);
  } catch (err) {
    return fail(err);
  }
});

// Renders a document to PDF (A4) and lets the user save it, e.g. to attach on WhatsApp.
ipcMain.handle('pos:savePdf', async (_e, { html, name = 'document', landscape = false } = {}) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', landscape: !!landscape, printBackground: true, margins: { marginType: 'none' } });
    const safe = String(name).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), `${safe}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return ok(null);
    fs.writeFileSync(filePath, pdf);
    shell.showItemInFolder(filePath);
    return ok(filePath);
  } catch (err) {
    return fail(err);
  } finally {
    win.destroy();
  }
});

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
    kdsServer?.stop();
    lanServer?.stop();
    etaSubmitter?.stop();
    try { db?.close(); } catch { /* already closed */ }
    app.quit();
  });
}
