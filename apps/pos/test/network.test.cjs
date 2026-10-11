'use strict';
// Several computers on one database: the main computer's network server (lan-server.cjs)
// and the client (remote.cjs), over real HTTP on this machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../electron/db.cjs');
const { createServices } = require('../electron/services/index.cjs');
const { entitlements } = require('../electron/editions.cjs');
const { createLanServer } = require('../electron/lan-server.cjs');
const { createRemote } = require('../electron/remote.cjs');
const { remoteAllowed } = require('../electron/exposed.cjs');

const code = async (p) => { try { await p; } catch (e) { return e.code; } return null; };

test('network: connected computers share the data, keep their own shift and printer, obey the device limit', async () => {
  const db = openDatabase(':memory:');
  let ent = entitlements({ edition: 'market', limits: { devices: 2 } });
  const ents = () => ent;
  const main = createServices(db, { entitlements: ents });
  main.auth.setup({ business: { business_name: 'Shop', business_type: 'retail', tax_rate: 0 }, admin: { name: 'Admin', username: 'admin', pin: '1234' } });
  main.auth.login({ username: 'admin', pin: '1234' });
  const pen = main.products.save({ name: 'Pen', price: 500, cost: 300, stock: 10 });
  main.settings.save({ printer_name: 'Main printer' });

  const port = 17000 + Math.floor(Math.random() * 2000);
  const cfg = { serve: { port, key: 'secret-key-123' } };
  const lan = createLanServer({
    local: main,
    makeServices: (deviceId) => createServices(db, { entitlements: ents, deviceId }),
    getConfig: () => cfg,
    licenseOk: () => true,
    info: () => ({ version: '1.0.0', business_name: 'Shop' }),
  });
  const st = await lan.start();
  assert.equal(st.running, true);
  try {
    const server = { host: '127.0.0.1', port, key: cfg.serve.key };
    const a = createRemote({ server, deviceId: 'device-aaaa-1111', deviceName: 'Till 2' });

    const info = await a.info();
    assert.equal(info.app, 'innoforge-pos');
    assert.equal(info.entitlements.edition, 'market');

    // Its own login and shift; the main computer's shift is separate.
    assert.equal(await code(a.call('orders.checkout', [{ items: [], payments: [] }])), 'NOT_LOGGED_IN');
    await a.call('auth.login', [{ username: 'admin', pin: '1234' }]);
    await a.call('settings.save', [{ printer_name: 'Till 2 printer', business_name: 'Shop Ltd' }]);
    assert.equal((await a.call('settings.get')).printer_name, 'Till 2 printer');
    assert.equal(main.settings.get().printer_name, 'Main printer'); // per computer
    assert.equal(main.settings.get().business_name, 'Shop Ltd'); // shared
    assert.equal(await code(a.call('orders.checkout', [{ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 500 }] }])), 'NO_OPEN_SHIFT');
    main.shifts.open({});
    assert.equal(await code(a.call('orders.checkout', [{ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 500 }] }])), 'NO_OPEN_SHIFT');
    await a.call('shifts.open', [{}]);
    const order = await a.call('orders.checkout', [{ items: [{ product_id: pen, qty: 2 }], payments: [{ method: 'cash', amount: 1000 }] }]);
    assert.equal(order.total, 1000);
    // Same stock everywhere.
    assert.equal(main.products.get(pen).stock, 8);
    assert.equal(db.prepare('SELECT device_id FROM orders WHERE id = ?').get(order.id).device_id, 'device-aaaa-1111');
    // Top-level helpers the main process needs.
    await a.call('requirePerm', ['backup']);
    // Exports run where the data is.
    const sheets = await a.exportSheets('products', {});
    assert.equal(sheets[0].rows.length, 1);

    // Wrong key, unknown or internal functions.
    const bad = createRemote({ server: { ...server, key: 'nope-nope-nope' }, deviceId: 'device-aaaa-1111' });
    assert.equal(await code(bad.info()), 'NETWORK_KEY');
    assert.equal(await code(a.call('admitDevice', ['x', 'y'])), 'UNKNOWN_METHOD');
    assert.equal(await code(a.call('kds.ensureKey.x')), 'UNKNOWN_METHOD');
    assert.equal(remoteAllowed('session'), false);
    assert.equal(remoteAllowed('kds.bump'), true);

    // The license allows 2 computers: the main one and Till 2.
    const b = createRemote({ server, deviceId: 'device-bbbb-2222', deviceName: 'Till 3' });
    assert.equal(await code(b.info()), 'LIMIT_DEVICES');
    const list = main.devices.list();
    assert.deepEqual(list.map((d) => [d.kind, d.name]), [['main', ''], ['client', 'Till 2']]);
    assert.equal(list[1].open_shifts, 1);

    // Blocking a computer cuts it off; that frees a seat for another.
    main.devices.save({ id: 'device-aaaa-1111', name: 'Till 2', active: false });
    lan.forget('device-aaaa-1111');
    assert.equal(await code(a.call('settings.get')), 'DEVICE_BLOCKED');
    assert.equal((await b.info()).device.id, 'device-bbbb-2222');
    assert.equal(await code(Promise.resolve().then(() => main.devices.save({ id: 'device-aaaa-1111', name: 'Till 2', active: true }))), 'LIMIT_DEVICES');

    // A fresh start forgets who was logged in on that computer.
    await b.call('auth.login', [{ username: 'admin', pin: '1234' }]);
    assert.ok((await b.call('auth.status')).user);
    await b.reset();
    assert.equal((await b.call('auth.status')).user, null);

    // Basic edition: a single computer.
    ent = entitlements({ edition: 'basic' });
    assert.equal(await code(createRemote({ server, deviceId: 'device-cccc-3333' }).info()), 'LIMIT_DEVICES');
  } finally {
    await lan.stop();
  }
});

test('network: the main computer is offline', async () => {
  const r = createRemote({ server: { host: '127.0.0.1', port: 1, key: 'k' }, deviceId: 'device-dddd-4444' });
  assert.equal(await code(r.info(1500)), 'SERVER_OFFLINE');
});
