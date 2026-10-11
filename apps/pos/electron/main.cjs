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

// Only these namespaces are reachable from the renderer.
const EXPOSED = ['settings', 'auth', 'users', 'categories', 'products', 'tables', 'shifts', 'orders', 'suppliers', 'purchases', 'expenses', 'customers', 'reports', 'auditLog', 'commissions', 'importer', 'priceLists', 'quotes', 'stockCounts', 'promotions', 'rebates', 'floor', 'kitchenStations', 'purchaseOrders', 'modifiers', 'delivery', 'treasury', 'warehouses', 'installments', 'coupons', 'giftCards', 'employees'];

// Lets a portable install or tests keep data in a chosen folder.
if (process.env.INNOFORGE_POS_DATA_DIR) app.setPath('userData', path.resolve(process.env.INNOFORGE_POS_DATA_DIR));

let db;
let services;
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

function licenseOk() {
  if (!licenseRequired()) return true;
  if (!license?.valid) return false;
  if (license.expires && Date.now() > Date.parse(license.expires)) license = licenses.status();
  return license.valid;
}

// What this copy may use. From source (not packaged) everything is on, unless
// INNOFORGE_POS_EDITION=basic|market|… is set to try an edition.
function currentEntitlements() {
  if (!licenseRequired()) {
    const ed = !app.isPackaged && process.env.INNOFORGE_POS_EDITION;
    return ed ? entitlements({ edition: ed }) : FULL;
  }
  if (!license?.valid) return FULL; // nothing runs without a valid license anyway
  return { edition: license.edition, features: new Set(license.features), addons: license.addons, limits: license.limits };
}
const entitlementsJSON = () => { const e = currentEntitlements(); return { edition: e.edition, features: [...e.features], addons: e.addons, limits: e.limits }; };

function boot() {
  db = openDatabase(dbFile());
  services = createServices(db, { entitlements: currentEntitlements });
  licenses = createLicenseStore({
    file: path.join(app.getPath('userData'), 'license.json'),
    publicKeyPem: require('./license-public.cjs'),
  });
  license = licenses.status();
  autoBackup('daily');
  kdsServer = createKdsServer({ services, customerState: () => customerState });
  kdsServer.start().catch((err) => console.error('kitchen screen server', err));
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
  // Serial scales (Web Serial). The port is chosen here, by the name saved in Settings → Devices;
  // 'list only' requests just report the ports so the settings screen can show them.
  const ses = mainWindow.webContents.session;
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    const ports = portList.map((p) => ({ portId: p.portId, portName: p.portName, displayName: p.displayName || p.portName }));
    mainWindow.webContents.send('pos:serial-ports', ports);
    if (serialListOnly) { serialListOnly = false; callback(''); return; }
    const wanted = services.settings.get().scale_port;
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

ipcMain.handle('pos:call', (_e, ns, method, arg) => {
  try {
    const target = EXPOSED.includes(ns) ? services[ns] : null;
    if (!target || typeof target[method] !== 'function') throw new PosError('UNKNOWN_METHOD', `${ns}.${method}`);
    if (!ALLOWED_UNLICENSED.has(`${ns}.${method}`) && !licenseOk()) throw new PosError('LICENSE_REQUIRED');
    const result = target[method](arg);
    // Kitchen screen settings take effect right away.
    if (ns === 'settings' && (method === 'newKdsKey' || (method === 'save' && arg && ('kds_lan' in arg || 'kds_port' in arg)))) {
      return kdsServer.start().then(() => ok(result));
    }
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
    if (manual) services.drawer.authorize({ approval });
    const s = services.settings.get();
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

ipcMain.handle('pos:license', () => ok({ ...license, ...entitlementsJSON(), required: licenseRequired(), valid: licenseOk() }));

ipcMain.handle('pos:activate', (_e, key) => {
  const result = licenses.activate(key);
  if (result.valid) {
    license = result;
    services.audit('license_activate', { userId: null, details: { customer: result.customer, expires: result.expires, edition: result.edition } });
  }
  return result.valid ? ok({ ...result, ...entitlementsJSON(), required: licenseRequired() }) : fail(new PosError(`LICENSE_${result.reason}`));
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

// ---------- Excel ----------
const xlsxFilter = [{ name: 'Excel', extensions: ['xlsx'] }];
const stampName = (base) => `${base}-${new Date().toLocaleDateString('en-CA')}.xlsx`;

ipcMain.handle('pos:excelTemplate', async (_e, kind) => {
  try {
    services.requirePerm('backup');
    services.license.requireFeature('excel');
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
    services.requirePerm('backup');
    services.license.requireFeature('excel');
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

function exportSheets(kind, params = {}) {
  const t = (ar, en) => `${ar} | ${en}`;
  const s = services;
  if (kind === 'products') {
    s.requirePerm('backup');
    const showCost = s.can('view_cost');
    return [{
      name: 'products',
      columns: [
        { header: excel.COLUMNS.products.name[0], key: 'name', width: 32 },
        { header: excel.COLUMNS.products.barcode[0], key: 'barcode', width: 18 },
        { header: excel.COLUMNS.products.category[0], key: 'category_name', width: 18 },
        { header: excel.COLUMNS.products.price[0], key: 'price', money: true },
        ...(showCost ? [{ header: excel.COLUMNS.products.cost[0], key: 'cost', money: true }] : []),
        { header: excel.COLUMNS.products.stock[0], key: 'stock' },
        { header: excel.COLUMNS.products.min_stock[0], key: 'min_stock' },
        { header: excel.COLUMNS.products.unit[0], key: 'unit' },
        { header: excel.COLUMNS.products.track_stock[0], key: 'track' },
        { header: excel.COLUMNS.products.author[0], key: 'author' },
        { header: excel.COLUMNS.products.publisher[0], key: 'publisher' },
      ],
      rows: s.products.list({ includeInactive: true }).map((p) => ({ ...p, track: p.track_stock ? 'نعم' : 'لا' })),
    }];
  }
  if (kind === 'customers' || kind === 'suppliers') {
    s.requirePerm('backup');
    const list = kind === 'customers' ? s.customers.list({ includeInactive: true }) : s.suppliers.list({ includeInactive: true });
    const cols = excel.COLUMNS[kind];
    return [{
      name: kind,
      columns: [
        { header: cols.name[0], key: 'name', width: 28 },
        { header: cols.phone[0], key: 'phone', width: 16 },
        { header: cols.address[0], key: 'address', width: 24 },
        ...(kind === 'customers' ? [{ header: cols.tax_number[0], key: 'tax_number', width: 18 }, { header: cols.credit_limit[0], key: 'credit_limit', money: true }] : []),
        // Exported as the opening balance so the file can be re-imported elsewhere as-is.
        { header: cols.opening_balance[0], key: 'balance', money: true, width: 20 },
        { header: cols.notes[0], key: 'notes', width: 24 },
      ],
      rows: list,
    }];
  }
  if (kind === 'invoices') {
    s.requirePerm('reports');
    const orders = s.orders.list({ from: params.from, to: params.to, limit: 100000 });
    const items = orders.flatMap((o) => s.orders.get(o.id).items.map((i) => ({ ...i, invoice_no: o.invoice_no, completed_at: o.completed_at })));
    return [
      {
        name: 'invoices',
        columns: [
          { header: t('رقم الفاتورة', 'Invoice'), key: 'invoice_no' }, { header: t('التاريخ', 'Date'), key: 'completed_at', width: 20 },
          { header: t('العميل', 'Customer'), key: 'customer_display', width: 24 }, { header: t('الكاشير', 'Cashier'), key: 'user_name' },
          { header: t('النوع', 'Type'), key: 'order_type' }, { header: t('المجموع', 'Subtotal'), key: 'subtotal', money: true },
          { header: t('الخصم', 'Discount'), key: 'discount', money: true }, { header: t('الضريبة', 'Tax'), key: 'tax', money: true },
          { header: t('الخدمة', 'Service'), key: 'service', money: true }, { header: t('الإجمالي', 'Total'), key: 'total', money: true },
          { header: t('آجل', 'On account'), key: 'credit', money: true }, { header: t('مرتجع', 'Refunded'), key: 'refunded', money: true },
        ],
        rows: orders,
      },
      {
        name: 'items',
        columns: [
          { header: t('رقم الفاتورة', 'Invoice'), key: 'invoice_no' }, { header: t('التاريخ', 'Date'), key: 'completed_at', width: 20 },
          { header: t('الصنف', 'Item'), key: 'name', width: 30 }, { header: t('الكمية', 'Qty'), key: 'qty' },
          { header: t('السعر', 'Price'), key: 'unit_price', money: true }, { header: t('الخصم', 'Discount'), key: 'discount', money: true },
          { header: t('الإجمالي', 'Total'), key: 'line_total', money: true }, { header: t('مرتجع', 'Returned'), key: 'returned_qty' },
        ],
        rows: items,
      },
    ];
  }
  if (kind === 'report') {
    const r = s.reports.summary({ from: params.from, to: params.to });
    const money = (key, header) => ({ header, key, money: true });
    const totals = Object.entries(r.totals).filter(([, v]) => v != null).map(([k, v]) => ({ k, v }));
    return [
      { name: 'summary', columns: [{ header: t('البند', 'Item'), key: 'k', width: 24 }, { header: t('القيمة', 'Value'), key: 'v', width: 18 }], rows: totals.map((x) => ({ ...x, v: ['orders'].includes(x.k) ? x.v : x.v / 10 ** (s.settings.get().decimals ?? 2) })) },
      { name: 'by day', columns: [{ header: t('اليوم', 'Day'), key: 'day' }, { header: t('الفواتير', 'Invoices'), key: 'orders' }, money('total', t('الإجمالي', 'Total'))], rows: r.byDay },
      { name: 'top products', columns: [{ header: t('الصنف', 'Item'), key: 'name', width: 30 }, { header: t('الكمية', 'Qty'), key: 'qty' }, money('total', t('الإجمالي', 'Total'))], rows: r.topProducts },
      { name: 'by method', columns: [{ header: t('الطريقة', 'Method'), key: 'method' }, money('amount', t('المبلغ', 'Amount'))], rows: r.byMethod },
      { name: 'by category', columns: [{ header: t('التصنيف', 'Category'), key: 'name' }, money('total', t('الإجمالي', 'Total'))], rows: r.byCategory },
      { name: 'by cashier', columns: [{ header: t('الكاشير', 'Cashier'), key: 'name' }, { header: t('الفواتير', 'Invoices'), key: 'orders' }, money('total', t('الإجمالي', 'Total'))], rows: r.byCashier },
      { name: 'commissions', columns: [{ header: t('الاسم', 'Name'), key: 'name' }, money('net', t('صافي المبيعات', 'Net sales')), { header: '%', key: 'rate' }, money('commission', t('العمولة', 'Commission'))], rows: s.commissions.report(params) },
    ];
  }
  throw new PosError('UNKNOWN_METHOD', kind);
}

ipcMain.handle('pos:excelExport', async (_e, { kind, ...params } = {}) => {
  try {
    const sheets = exportSheets(kind, params); // checks permissions before asking where to save
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: stampName(`innoforge-${kind}`), filters: xlsxFilter });
    if (canceled || !filePath) return ok(null);
    await excel.writeSheets(filePath, sheets, services.settings.get().decimals ?? 2);
    services.audit('export', { details: { kind } });
    return ok(filePath);
  } catch (err) {
    return fail(err);
  }
});

// One report from the Reports page as a formatted Excel file. The numbers are re-read
// from the services (never trusted from the window); only the translated texts come from it.
ipcMain.handle('pos:reportExcel', async (_e, { id, from, to, labels } = {}) => {
  try {
    const report = services.reports.run({ id, from, to });
    const s = services.settings.get();
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), `${String(labels?.title || id).replace(/[\\/:*?"<>|]+/g, '-')} ${from || ''}${to && to !== from ? ` - ${to}` : ''}.xlsx`.replace(/\s+\.xlsx$/, '.xlsx')),
      filters: xlsxFilter,
    });
    if (canceled || !filePath) return ok(null);
    await excel.writeReport(filePath, report, { labels: labels || { title: id, columns: {} }, business: s.business_name, decimals: s.decimals ?? 2, currency: s.currency, rtl: s.language !== 'en' });
    services.audit('export', { details: { kind: `report:${id}` } });
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
    try { db?.close(); } catch { /* already closed */ }
    app.quit();
  });
}
