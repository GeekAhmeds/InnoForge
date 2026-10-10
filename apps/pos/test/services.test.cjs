'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../electron/db.cjs');
const { createServices } = require('../electron/services/index.cjs');
const { computeTotals } = require('../electron/services/totals.cjs');

function setup(business = {}) {
  const db = openDatabase(':memory:');
  const s = createServices(db);
  s.auth.setup({
    business: { business_name: 'Test Shop', business_type: 'retail', ...business },
    admin: { name: 'Admin', username: 'admin', pin: '1234' },
  });
  s.auth.login({ username: 'admin', pin: '1234' });
  return { db, s };
}

const tryCode = (fn) => {
  try { fn(); } catch (e) { return e.code; }
  return null;
};

test('totals: exclusive tax, discounts and service', () => {
  const t = computeTotals(
    [{ unit_price: 1000, qty: 2, discount: 100 }, { unit_price: 550, qty: 1 }],
    { discount: 250, taxRate: 14, serviceRate: 10 },
  );
  assert.equal(t.subtotal, 2450);
  assert.equal(t.discount, 250);
  assert.equal(t.service, 220);
  assert.equal(t.tax, Math.round(2420 * 0.14));
  assert.equal(t.total, 2420 + t.tax);
});

test('totals: inclusive tax does not change the total', () => {
  const t = computeTotals([{ unit_price: 1140, qty: 1 }], { taxRate: 14, pricesIncludeTax: true });
  assert.equal(t.total, 1140);
  assert.equal(t.tax, 140);
});

test('setup creates admin and refuses a second run; bad pin rejected', () => {
  const { s } = setup();
  assert.equal(s.auth.status().setupDone, true);
  assert.equal(tryCode(() => s.auth.setup({ business: { business_name: 'x' }, admin: { name: 'a', username: 'b', pin: '1111' } })), 'ALREADY_SETUP');
  s.auth.logout();
  assert.equal(tryCode(() => s.auth.login({ username: 'admin', pin: '0000' })), 'BAD_CREDENTIALS');
});

test('checkout requires an open shift, prices from DB, decrements stock, computes change', () => {
  const { s, db } = setup({ tax_rate: 0 });
  const id = s.products.save({ name: 'Pen', barcode: '111', price: 500, cost: 300, stock: 10 });
  const cart = { items: [{ product_id: id, qty: 3, unit_price: 1 }], payments: [{ method: 'cash', amount: 2000 }] };
  assert.equal(tryCode(() => s.orders.checkout(cart)), 'NO_OPEN_SHIFT');
  s.shifts.open({ openingCash: 1000 });
  const order = s.orders.checkout(cart);
  assert.equal(order.total, 1500); // client-sent unit_price ignored
  assert.equal(order.change_due, 500);
  assert.equal(order.invoice_no, 1);
  assert.deepEqual(order.payments.map((p) => [p.method, p.amount]), [['cash', 1500]]);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock, 7);
  assert.equal(s.products.byBarcode('111').id, id);
});

test('payments: insufficient and non-cash overpay are rejected; split works', () => {
  const { s } = setup();
  const id = s.products.save({ name: 'Book', price: 10000, track_stock: false });
  s.shifts.open({});
  const items = [{ product_id: id, qty: 1 }];
  assert.equal(tryCode(() => s.orders.checkout({ items, payments: [{ method: 'cash', amount: 9999 }] })), 'INSUFFICIENT_PAYMENT');
  assert.equal(tryCode(() => s.orders.checkout({ items, payments: [{ method: 'card', amount: 11000 }] })), 'NON_CASH_OVERPAY');
  const o = s.orders.checkout({ items, payments: [{ method: 'card', amount: 6000 }, { method: 'cash', amount: 5000 }] });
  assert.equal(o.change_due, 1000);
  assert.deepEqual(o.payments.map((p) => [p.method, p.amount]), [['card', 6000], ['cash', 4000]]);
});

test('negative stock blocked when disabled', () => {
  const { s } = setup({ allow_negative_stock: false });
  const id = s.products.save({ name: 'Ink', price: 100, stock: 1 });
  s.shifts.open({});
  assert.equal(tryCode(() => s.orders.checkout({ items: [{ product_id: id, qty: 2 }], payments: [{ method: 'cash', amount: 200 }] })), 'OUT_OF_STOCK');
});

test('restaurant: table order, kitchen deltas, checkout frees table, service charge', () => {
  const { s } = setup({ business_type: 'restaurant', service_rate: 12, tax_rate: 14, prices_include_tax: false });
  const burger = s.products.save({ name: 'Burger', price: 10000, track_stock: false, kitchen: true });
  const table = s.tables.list()[0];
  s.shifts.open({});
  let order = s.orders.saveOpen({ order_type: 'dine_in', table_id: table.id, items: [{ product_id: burger, qty: 2 }] });
  assert.equal(s.tables.list()[0].order_id, order.id);
  assert.equal(tryCode(() => s.orders.saveOpen({ order_type: 'dine_in', table_id: table.id, items: [{ product_id: burger, qty: 1 }] })), 'TABLE_BUSY');
  let k = s.orders.sendToKitchen(order.id);
  assert.deepEqual(k.items.map((i) => i.qty), [2]);
  const line = order.items[0];
  order = s.orders.saveOpen({ id: order.id, order_type: 'dine_in', table_id: table.id, items: [{ id: line.id, product_id: burger, qty: 3 }] });
  k = s.orders.sendToKitchen(order.id);
  assert.deepEqual(k.items.map((i) => i.qty), [1]);
  assert.equal(order.service, 3600);
  assert.equal(order.total, 33600 + Math.round(33600 * 0.14));
  const done = s.orders.checkout({ id: order.id, order_type: 'dine_in', table_id: table.id, items: [{ id: line.id, product_id: burger, qty: 3 }], payments: [{ method: 'cash', amount: order.total }] });
  assert.equal(done.status, 'completed');
  assert.equal(done.table_name, table.name);
  assert.equal(s.tables.list()[0].order_id, null);
});

test('refund: partial then full, restocks, never exceeds paid, shift expected cash', () => {
  const { s, db } = setup();
  const a = s.products.save({ name: 'A', price: 333, stock: 10 });
  const b = s.products.save({ name: 'B', price: 667, stock: 10 });
  s.shifts.open({ openingCash: 500 });
  const o = s.orders.checkout({ items: [{ product_id: a, qty: 3 }, { product_id: b, qty: 1 }], discount: 100, payments: [{ method: 'cash', amount: 2000 }] });
  assert.equal(o.total, 1566);
  const lineA = o.items.find((i) => i.product_id === a);
  const lineB = o.items.find((i) => i.product_id === b);
  let r = s.orders.refund({ orderId: o.id, items: [{ order_item_id: lineA.id, qty: 1 }] });
  assert.equal(r.refunded, Math.round(1566 * (333 / 1666)));
  assert.equal(tryCode(() => s.orders.refund({ orderId: o.id, items: [{ order_item_id: lineA.id, qty: 3 }] })), 'RETURN_EXCEEDS_SOLD');
  r = s.orders.refund({ orderId: o.id, items: [{ order_item_id: lineA.id, qty: 2 }, { order_item_id: lineB.id, qty: 1 }] });
  assert.equal(r.refunded, 1566);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(a).stock, 10);
  const closed = s.shifts.close({ countedCash: 500 });
  assert.equal(closed.expectedCash, 500);
  assert.equal(closed.shift.counted_cash, 500);
});

test('cashier cannot change settings or refund', () => {
  const { s } = setup();
  s.users.save({ name: 'Cash', username: 'c1', pin: '5555', role: 'cashier' });
  s.auth.logout();
  s.auth.login({ username: 'c1', pin: '5555' });
  assert.equal(tryCode(() => s.settings.save({ tax_rate: 5 })), 'FORBIDDEN');
  assert.equal(tryCode(() => s.orders.refund({ orderId: 1, items: [] })), 'FORBIDDEN');
  assert.equal(tryCode(() => s.products.save({ name: 'x', price: 1 })), 'FORBIDDEN');
});

test('reports summarize sales by method, product and profit', () => {
  const { s } = setup();
  const a = s.products.save({ name: 'A', price: 1000, cost: 600, stock: 5 });
  s.shifts.open({});
  s.orders.checkout({ items: [{ product_id: a, qty: 2 }], payments: [{ method: 'card', amount: 2000 }] });
  s.orders.checkout({ items: [{ product_id: a, qty: 1 }], payments: [{ method: 'cash', amount: 1000 }] });
  const r = s.reports.summary({});
  assert.equal(r.totals.orders, 2);
  assert.equal(r.totals.gross, 3000);
  assert.equal(r.totals.profit, 1200);
  assert.equal(r.topProducts[0].qty, 3);
  assert.deepEqual(r.byMethod.map((m) => m.method).sort(), ['card', 'cash']);
});
