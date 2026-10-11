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
  assert.equal(tryCode(() => s.orders.refund({ orderId: 1, items: [] })), 'APPROVAL_REQUIRED');
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

test('purchase receives stock, averages cost, tracks supplier balance and payments', () => {
  const { s, db } = setup();
  const p = s.products.save({ name: 'Notebook', price: 3500, cost: 2000, stock: 10 });
  const sup = s.suppliers.save({ name: 'Nile Paper', phone: '0100' });
  s.shifts.open({ openingCash: 10000 });
  const pur = s.purchases.create({
    supplierId: sup, refNo: 'INV-7', items: [{ product_id: p, qty: 10, unit_cost: 2600 }], discount: 1000,
    paid: 10000, method: 'cash', fromDrawer: true, updatePrices: [{ product_id: p, price: 4000 }],
  });
  assert.equal(pur.total, 25000);
  const prod = db.prepare('SELECT stock, cost, price FROM products WHERE id = ?').get(p);
  assert.equal(prod.stock, 20);
  assert.equal(prod.cost, Math.round((10 * 2000 + 10 * 2500) / 20)); // discount spread into cost
  assert.equal(prod.price, 4000);
  assert.equal(s.suppliers.list({})[0].balance, 15000);
  const st = s.suppliers.pay({ supplierId: sup, amount: 5000, method: 'card' });
  assert.equal(st.supplier.balance, 10000);
  assert.deepEqual(st.rows.map((r) => r.balance), [25000, 15000, 10000]);
  assert.equal(s.shifts.summary().expectedCash, 0); // 10000 opening - 10000 paid from drawer
});

test('expenses reduce drawer cash and net profit; cashier limited to drawer expenses', () => {
  const { s } = setup();
  const a = s.products.save({ name: 'A', price: 1000, cost: 400, stock: 5 });
  s.shifts.open({ openingCash: 2000 });
  s.orders.checkout({ items: [{ product_id: a, qty: 2 }], payments: [{ method: 'cash', amount: 2000 }] });
  s.expenses.create({ category: 'كهرباء', amount: 300, fromDrawer: true });
  s.expenses.create({ category: 'إيجار', amount: 500, fromDrawer: false });
  assert.equal(s.shifts.summary().expectedCash, 2000 + 2000 - 300);
  const r = s.reports.summary({});
  assert.equal(r.totals.expenses, 800);
  assert.equal(r.totals.netProfit, 1200 - 800);
  s.users.save({ name: 'C', username: 'c2', pin: '7777', role: 'cashier' });
  s.auth.logout();
  s.auth.login({ username: 'c2', pin: '7777' });
  assert.equal(tryCode(() => s.expenses.create({ amount: 100, fromDrawer: false })), 'APPROVAL_REQUIRED');
  assert.ok(s.expenses.create({ amount: 100, fromDrawer: true }).id);
  assert.equal(tryCode(() => s.purchases.list({})), 'FORBIDDEN');
});

test('drawer payments need an open shift; paying needs a supplier', () => {
  const { s } = setup();
  const p = s.products.save({ name: 'X', price: 100 });
  const sup = s.suppliers.save({ name: 'S' });
  assert.equal(tryCode(() => s.purchases.create({ supplierId: sup, items: [{ product_id: p, qty: 1, unit_cost: 50 }], paid: 50, fromDrawer: true })), 'NO_OPEN_SHIFT');
  assert.equal(tryCode(() => s.purchases.create({ items: [{ product_id: p, qty: 1, unit_cost: 50 }], paid: 50 })), 'SUPPLIER_REQUIRED');
  assert.equal(s.purchases.create({ items: [{ product_id: p, qty: 1, unit_cost: 50 }] }).total, 50);
});

test('credit sale: needs a customer, respects credit limit, builds a statement and collections hit the drawer', () => {
  const { s } = setup();
  const p = s.products.save({ name: 'Box', price: 10000, track_stock: false });
  s.shifts.open({ openingCash: 0 });
  const items = [{ product_id: p, qty: 1 }];
  assert.equal(tryCode(() => s.orders.checkout({ items, payments: [{ method: 'cash', amount: 4000 }] })), 'INSUFFICIENT_PAYMENT');
  const cust = s.customers.save({ name: 'Nour Trading', phone: '0100', credit_limit: 20000 });
  const o1 = s.orders.checkout({ items, customer_id: cust, payments: [{ method: 'cash', amount: 4000 }] });
  assert.equal(o1.credit, 6000);
  assert.equal(o1.customer_balance, 6000);
  const o2 = s.orders.checkout({ items, customer_id: cust, payments: [] }); // fully on account
  assert.equal(o2.credit, 10000);
  assert.equal(tryCode(() => s.orders.checkout({ items, customer_id: cust, payments: [] })), 'CREDIT_LIMIT_EXCEEDED');
  s.customers.collect({ customerId: cust, amount: 5000, method: 'cash' });
  s.customers.collect({ customerId: cust, amount: 1000, method: 'card' });
  const st = s.customers.statement({ id: cust });
  assert.equal(st.balance, 10000);
  assert.deepEqual(st.rows.map((r) => r.balance), [6000, 16000, 11000, 10000]);
  assert.equal(s.customers.list({ owingOnly: true })[0].balance, 10000);
  const sum = s.shifts.summary();
  assert.equal(sum.creditSales, 16000);
  assert.equal(sum.expectedCash, 4000 + 5000);
  const r = s.reports.summary({});
  assert.equal(r.totals.receivables, 10000);
  assert.equal(r.topCustomers[0].name, 'Nour Trading');
});

test('returning a credit sale reduces the customer balance before paying cash', () => {
  const { s } = setup();
  const p = s.products.save({ name: 'Item', price: 5000, stock: 10 });
  s.shifts.open({ openingCash: 0 });
  const cust = s.customers.save({ name: 'C1' });
  const o = s.orders.checkout({ items: [{ product_id: p, qty: 2 }], customer_id: cust, payments: [{ method: 'cash', amount: 2000 }] });
  assert.equal(o.credit, 8000);
  s.orders.refund({ orderId: o.id, items: [{ order_item_id: o.items[0].id, qty: 1 }] }); // 5000 back
  assert.equal(s.customers.get(cust).balance, 3000);
  assert.equal(s.shifts.summary().expectedCash, 2000); // nothing left the drawer
  s.orders.refund({ orderId: o.id, items: [{ order_item_id: o.items[0].id, qty: 1 }] }); // 5000: 3000 account + 2000 cash
  assert.equal(s.customers.get(cust).balance, 0);
  assert.equal(s.shifts.summary().expectedCash, 0);
});

test('cashier can add customers but not set credit limits', () => {
  const { s } = setup();
  s.users.save({ name: 'K', username: 'k1', pin: '4444', role: 'cashier' });
  s.auth.logout();
  s.auth.login({ username: 'k1', pin: '4444' });
  const id = s.customers.save({ name: 'Walk-in Co', phone: '0111', credit_limit: 999999 });
  assert.equal(s.customers.get(id).credit_limit, 0);
  assert.equal(tryCode(() => s.customers.save({ name: 'Dup', phone: '0111' })), 'DUPLICATE_PHONE');
});

test('permissions: role defaults, overrides, supervisor approval for discounts and refunds, audit trail', async () => {
  const { s, db } = setup();
  const p = s.products.save({ name: 'Lamp', price: 10000, cost: 6000, track_stock: false });
  s.users.save({ name: 'Sara', username: 'sup', pin: '2222', role: 'supervisor' });
  s.users.save({ name: 'Omar', username: 'cash', pin: '3333', role: 'cashier', commission_rate: 2 });
  s.shifts.open({});
  s.auth.logout();
  s.auth.login({ username: 'cash', pin: '3333' });
  const me = s.auth.status().user;
  assert.equal(me.perms.discount, true);
  assert.equal(me.perms.max_discount, 10);
  assert.equal(me.perms.view_cost, false);
  assert.equal(s.products.list({})[0].cost, undefined); // cost hidden from cashiers
  const items = [{ product_id: p, qty: 1 }];
  // 10% is within the cashier's limit
  s.orders.checkout({ items, discount: 1000, payments: [{ method: 'cash', amount: 9000 }] });
  // 25% needs a supervisor (max 30%)
  assert.equal(tryCode(() => s.orders.checkout({ items, discount: 2500, payments: [{ method: 'cash', amount: 7500 }] })), 'APPROVAL_REQUIRED');
  assert.equal(tryCode(() => s.orders.checkout({ items, discount: 2500, payments: [{ method: 'cash', amount: 7500 }], approval: { username: 'sup', pin: '0000' } })), 'BAD_CREDENTIALS');
  const o = s.orders.checkout({ items, discount: 2500, payments: [{ method: 'cash', amount: 7500 }], approval: { username: 'sup', pin: '2222' } });
  // 50% is beyond even the supervisor
  assert.equal(tryCode(() => s.orders.checkout({ items, discount: 5000, payments: [{ method: 'cash', amount: 5000 }], approval: { username: 'sup', pin: '2222' } })), 'APPROVER_NOT_ALLOWED');
  // price change needs approval too
  assert.equal(tryCode(() => s.orders.checkout({ items: [{ product_id: p, qty: 1, unit_price: 8000, price_override: true }], payments: [{ method: 'cash', amount: 8000 }] })), 'APPROVAL_REQUIRED');
  // refunds: cashier needs approval, settings simply forbidden
  assert.equal(tryCode(() => s.orders.refund({ orderId: o.id, items: [{ order_item_id: o.items[0].id, qty: 1 }] })), 'APPROVAL_REQUIRED');
  s.orders.refund({ orderId: o.id, items: [{ order_item_id: o.items[0].id, qty: 1 }], approval: { username: 'sup', pin: '2222' } });
  assert.equal(tryCode(() => s.settings.save({ tax_rate: 1 })), 'FORBIDDEN');
  assert.equal(tryCode(() => s.auditLog.list({})), 'FORBIDDEN');
  // admin grants this cashier a personal override
  s.auth.logout();
  assert.equal(tryCode(() => s.auth.login({ username: 'admin', pin: '9999' })), 'BAD_CREDENTIALS');
  s.auth.login({ username: 'admin', pin: '1234' });
  const cashId = db.prepare("SELECT id FROM users WHERE username = 'cash'").get().id;
  s.users.save({ id: cashId, name: 'Omar', username: 'cash', role: 'cashier', overrides: { refund: true, max_discount: 30 }, commission_rate: 2 });
  await new Promise(setImmediate); // failed-attempt entries are written after their rollback
  const log = s.auditLog.list({});
  const actions = log.map((l) => l.action);
  for (const a of ['login', 'discount', 'refund', 'login_failed', 'approval_failed', 'user_update']) assert.ok(actions.includes(a), a);
  assert.equal(log.find((l) => l.action === 'refund').approver_name, 'Sara');
  const com = s.commissions.report({}).find((r) => r.name === 'Omar');
  assert.equal(com.net, 9000 + 7500 - 7500);
  assert.equal(com.commission, 180);
  s.auth.logout();
  s.auth.login({ username: 'cash', pin: '3333' });
  assert.equal(s.auth.status().user.perms.max_discount, 30);
});

test('excel import: products upsert by barcode with stock adjustment, customers with opening balance, row errors', () => {
  const { s, db } = setup();
  const r1 = s.importer.products({ rows: [
    { name: 'قلم', barcode: '111', category: 'أدوات', price: '5.5', cost: '3', stock: '100' },
    { name: 'كشكول', barcode: '', category: 'أدوات', price: '٢٥', stock: '' },
    { name: '', price: '1' },
    { name: 'غلط', price: 'abc' },
  ] });
  assert.deepEqual([r1.created, r1.updated, r1.errors.map((e) => e.code)], [2, 0, ['NAME_REQUIRED', 'INVALID_PRICE']]);
  const pen = db.prepare("SELECT * FROM products WHERE barcode = '111'").get();
  assert.equal(pen.price, 550);
  assert.equal(pen.stock, 100);
  assert.equal(db.prepare("SELECT price FROM products WHERE name = 'كشكول'").get().price, 2500);
  const r2 = s.importer.products({ rows: [{ name: 'قلم جاف', barcode: '111', price: '6', stock: '90' }] });
  assert.equal(r2.updated, 1);
  const pen2 = db.prepare("SELECT * FROM products WHERE barcode = '111'").get();
  assert.deepEqual([pen2.name, pen2.price, pen2.stock, pen2.cost], ['قلم جاف', 600, 90, 300]);
  const c = s.importer.customers({ rows: [{ name: 'شركة الأمل', phone: '0100', opening_balance: '1500', credit_limit: '5000' }] });
  assert.equal(c.created, 1);
  const cust = s.customers.list({})[0];
  assert.equal(cust.balance, 150000);
  assert.equal(cust.credit_limit, 500000);
  assert.equal(s.customers.statement({ id: cust.id }).balance, 150000);
  const sup = s.importer.suppliers({ rows: [{ name: 'مورد 1', opening_balance: '200' }] });
  assert.equal(sup.created, 1);
  assert.equal(s.suppliers.list({})[0].balance, 20000);
});

test('units and price lists: carton barcode, wholesale price for the customer, stock in base units', () => {
  const { s, db } = setup();
  const id = s.products.save({ name: 'Juice', barcode: 'J1', price: 1000, cost: 700, stock: 100,
    units: [{ name: 'Carton', factor: 12, barcode: 'J12', price: 11000 }, { name: 'Pack', factor: 6, barcode: 'J6' }] });
  const wholesale = s.priceLists.save({ name: 'جملة' });
  s.products.save({ id, name: 'Juice', barcode: 'J1', price: 1000, cost: 700, prices: { [wholesale]: 900 } });
  const prod = s.products.list({})[0];
  assert.equal(prod.units.length, 2); // kept when the editor did not send units
  assert.equal(prod.prices[wholesale], 900);
  const carton = s.products.byBarcode('J12');
  assert.equal(carton.unit.factor, 12);
  const cust = s.customers.save({ name: 'Shop', price_list_id: wholesale });
  s.shifts.open({});
  const pack = prod.units.find((u) => u.name === 'Pack');
  const o = s.orders.checkout({ customer_id: cust, items: [{ product_id: id, unit_id: carton.unit.id, qty: 2 }, { product_id: id, unit_id: pack.id, qty: 1 }, { product_id: id, qty: 3 }], payments: [{ method: 'cash', amount: 100000 }] });
  // carton has its own price; pack = wholesale 900 × 6; single = wholesale 900
  assert.deepEqual(o.items.map((i) => i.unit_price), [11000, 5400, 900]);
  assert.equal(o.items[0].name, 'Juice (Carton)');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock, 100 - 24 - 6 - 3);
  s.orders.refund({ orderId: o.id, items: [{ order_item_id: o.items[0].id, qty: 1 }] });
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock, 67 + 12);
  assert.equal(s.priceLists.fillFromBase({ id: wholesale, percent: -10 }), 0); // existing kept
});

test('purchases by carton set per-piece cost; batches expire FEFO; purchase returns credit the supplier', () => {
  const { s, db } = setup();
  const id = s.products.save({ name: 'Milk', price: 3000, cost: 0, track_expiry: true, units: [{ name: 'Box', factor: 10 }] });
  const box = s.products.list({})[0].units[0];
  const sup = s.suppliers.save({ name: 'Dairy' });
  const pur = s.purchases.create({ supplierId: sup, items: [
    { product_id: id, unit_id: box.id, qty: 2, unit_cost: 20000, expiry_date: '2026-11-01', batch_no: 'A' },
    { product_id: id, qty: 5, unit_cost: 2000, expiry_date: '2026-10-20', batch_no: 'B' },
  ] });
  const p = db.prepare('SELECT stock, cost FROM products WHERE id = ?').get(id);
  assert.equal(p.stock, 25);
  assert.equal(p.cost, 2000);
  s.shifts.open({});
  s.orders.checkout({ items: [{ product_id: id, qty: 7 }], payments: [{ method: 'cash', amount: 21000 }] });
  const batches = db.prepare('SELECT batch_no, qty FROM batches ORDER BY batch_no').all().map((b) => [b.batch_no, b.qty]);
  assert.deepEqual(batches, [['A', 18], ['B', 0]]); // earliest expiry (B) consumed first
  assert.ok(s.products.expiring({ days: 400 }).some((b) => b.batch_no === 'A'));
  assert.equal(s.suppliers.list({})[0].balance, 50000);
  const after = s.purchases.returnItems({ purchaseId: pur.id, items: [{ purchase_item_id: pur.items[0].id, qty: 1 }], reason: 'تالف' });
  assert.equal(after.returned, 20000);
  assert.equal(s.suppliers.list({})[0].balance, 30000);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock, 25 - 7 - 10);
  assert.equal(tryCode(() => s.purchases.returnItems({ purchaseId: pur.id, items: [{ purchase_item_id: pur.items[0].id, qty: 2 }] })), 'RETURN_EXCEEDS_SOLD');
});

test('quotes become invoices; aging buckets; serials required and searchable; stock count applies differences', () => {
  const { s, db } = setup();
  const phone = s.products.save({ name: 'Phone', price: 500000, stock: 5, track_serial: true });
  const cable = s.products.save({ name: 'Cable', barcode: 'C1', price: 5000, stock: 50 });
  const cust = s.customers.save({ name: 'Tech Co' });
  const q = s.quotes.create({ customer_id: cust, items: [{ product_id: phone, qty: 2 }, { product_id: cable, qty: 3 }], valid_until: '2026-12-31' });
  assert.equal(q.quote_no, 1);
  assert.equal(q.total, 1015000);
  s.quotes.setStatus({ id: q.id, status: 'order' });
  const cart = s.quotes.toCart(q.id);
  s.shifts.open({});
  assert.equal(tryCode(() => s.orders.checkout({ ...cart, payments: [] })), 'SERIALS_REQUIRED');
  cart.items[0].serials = 'IMEI-111, IMEI-222';
  const o = s.orders.checkout({ ...cart, payments: [{ method: 'cash', amount: 15000 }] });
  assert.equal(s.quotes.get(q.id).status, 'invoiced');
  assert.equal(o.credit, 1000000);
  assert.equal(s.orders.findSerial('IMEI-222')[0].invoice_no, o.invoice_no);
  assert.equal(s.orders.findSerial('IMEI-22').length, 0);
  // age the invoice by 45 days
  assert.ok(o.due_date > o.completed_at.slice(0, 10)); // general terms (30 days)
  db.prepare("UPDATE orders SET completed_at = datetime('now', 'localtime', '-45 days'), due_date = date('now', 'localtime', '-15 days') WHERE id = ?").run(o.id);
  s.customers.collect({ customerId: cust, amount: 200000, method: 'cash' });
  const ag = s.customers.aging({ overdueDays: 30 })[0];
  assert.deepEqual([ag.total, ag.b60, ag.overdue], [800000, 800000, 800000]);
  // stock count
  const count = s.stockCounts.start({});
  s.stockCounts.set({ id: count.id, barcode: 'C1', add: 1 });
  s.stockCounts.set({ id: count.id, barcode: 'C1', add: 1 });
  s.stockCounts.set({ id: count.id, productId: phone, counted: 3 });
  assert.equal(tryCode(() => s.stockCounts.start({})), 'COUNT_OPEN');
  s.stockCounts.apply(count.id);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(cable).stock, 2);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(phone).stock, 3);
});

test('promotions: buy 2 get 1, category percent with time window, best promo wins, exempt from discount permission', () => {
  const { s, db } = setup();
  const cat = s.categories.save({ name: 'Snacks' });
  const chips = s.products.save({ name: 'Chips', price: 1000, category_id: cat, track_stock: false });
  const soda = s.products.save({ name: 'Soda', price: 2000, track_stock: false });
  s.promotions.save({ name: '2+1', kind: 'buy_x_get_y', scope: 'product', target_id: chips, buy_qty: 2, get_qty: 1 });
  s.promotions.save({ name: 'Snacks 10%', kind: 'percent', scope: 'category', target_id: cat, value: 10 });
  s.promotions.save({ name: 'Night', kind: 'percent', scope: 'all', value: 50, time_from: '03:00', time_to: '03:01' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  s.promotions.save({ name: 'Expired', kind: 'percent', scope: 'all', value: 90, end_date: yesterday });
  const q = s.orders.quote({ items: [{ product_id: chips, qty: 6 }, { product_id: soda, qty: 1 }] });
  assert.equal(q.lines[0].promo_discount, 2000); // 2 free beats 10% (600)
  assert.equal(q.lines[0].promo_name, '2+1');
  assert.equal(q.lines[1].promo_discount || 0, new Date().toTimeString().slice(0, 5) === '03:00' ? 1000 : 0);
  s.users.save({ name: 'C', username: 'c9', pin: '9999', role: 'cashier', overrides: { discount: false } });
  s.shifts.open({});
  s.auth.logout();
  s.auth.login({ username: 'c9', pin: '9999' });
  const o = s.orders.checkout({ items: [{ product_id: chips, qty: 3 }], payments: [{ method: 'cash', amount: 2000 }] });
  assert.equal(o.total, 2000);
  assert.equal(o.items[0].promo_name, '2+1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get('discount').n, 0);
});

test('loyalty: earn on paid amount, redeem as payment, minimums, reversal on return', () => {
  const { s } = setup({ loyalty_enabled: true, loyalty_earn_per: 10, loyalty_point_value: 10, loyalty_min_redeem: 50 });
  const p = s.products.save({ name: 'Bag', price: 25000, stock: 10 });
  const cust = s.customers.save({ name: 'Mona', phone: '0123' });
  s.shifts.open({});
  const o1 = s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 2 }], payments: [{ method: 'cash', amount: 50000 }] });
  assert.equal(o1.points_earned, 50); // 500 EGP / 10
  assert.equal(s.customers.get(cust).points, 50);
  assert.equal(tryCode(() => s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 1 }], redeem_points: 60, payments: [{ method: 'cash', amount: 25000 }] })), 'NOT_ENOUGH_POINTS');
  assert.equal(tryCode(() => s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 1 }], redeem_points: 40, payments: [{ method: 'cash', amount: 25000 }] })), 'BELOW_MIN_REDEEM');
  const o2 = s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 1 }], redeem_points: 50, payments: [{ method: 'cash', amount: 24500 }] });
  assert.deepEqual(o2.payments.map((x) => [x.method, x.amount]), [['cash', 24500], ['points', 500]]);
  assert.equal(o2.points_earned, 24); // 245 EGP actually paid
  assert.equal(s.customers.get(cust).points, 24);
  s.orders.refund({ orderId: o1.id, items: [{ order_item_id: o1.items[0].id, qty: 1 }] });
  assert.equal(s.customers.get(cust).points, 0); // 25 points taken back, floored at 0
  assert.equal(tryCode(() => s.orders.checkout({ items: [{ product_id: p, qty: 1 }], redeem_points: 50, payments: [] })), 'LOYALTY_UNAVAILABLE');
});

test('collections: numbered receipts, invoice allocation, settlement discount, cheques, voids and advances', () => {
  const { s, db } = setup({ tax_rate: 0 });
  const p = s.products.save({ name: 'Box', price: 10000, stock: 100 });
  const cust = s.customers.save({ name: 'Nour Trading', payment_terms: 15 });
  s.shifts.open({ openingCash: 0 });
  const inv1 = s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 3 }], payments: [] }); // 300.00 on account
  const inv2 = s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 2 }], payments: [] }); // 200.00
  const today = new Date(); today.setDate(today.getDate() + 15);
  assert.equal(inv1.due_date, today.toLocaleDateString('en-CA')); // customer terms
  assert.equal(s.customers.openInvoices(cust).open.length, 2);

  // Pay the newer invoice explicitly; the older one stays open.
  const r1 = s.customers.collect({ customerId: cust, amount: 20000, method: 'cash', allocations: [{ order_id: inv2.id, amount: 20000 }] });
  assert.equal(r1.receipt.receipt_no, 1);
  assert.deepEqual(r1.receipt.allocations.map((a) => a.invoice_no), [inv2.invoice_no]);
  assert.equal(s.orders.get(inv2.id).open_amount, 0);
  assert.equal(s.orders.get(inv1.id).open_amount, 30000);
  assert.equal(tryCode(() => s.customers.collect({ customerId: cust, amount: 40000, allocations: [{ order_id: inv1.id, amount: 40000 }] })), 'ALLOCATION_EXCEEDS_DUE');

  // A cheque for 260 with a 40 settlement discount (13%, above the cashier's 10%) closes invoice 1; cashier needs approval for the discount.
  s.users.save({ name: 'Cash', username: 'cash', pin: '1111', role: 'cashier' });
  s.users.save({ name: 'Sup', username: 'sup', pin: '2222', role: 'supervisor' });
  s.auth.logout(); s.auth.login({ username: 'cash', pin: '1111' });
  const chequeArgs = { customerId: cust, amount: 26000, discount: 4000, method: 'cheque', cheque: { no: 'CH-77', bank: 'NBE', due: '2026-12-01' } };
  assert.equal(tryCode(() => s.customers.collect({ ...chequeArgs, cheque: { no: '' } })), 'CHEQUE_NO_REQUIRED');
  assert.equal(tryCode(() => s.customers.collect(chequeArgs)), 'APPROVAL_REQUIRED');
  const r2 = s.customers.collect({ ...chequeArgs, approval: { username: 'sup', pin: '2222' } });
  assert.equal(r2.receipt.receipt_no, 2);
  assert.equal(r2.receipt.discount, 4000);
  assert.equal(r2.customer.balance, 0);
  assert.equal(r2.customer.pending_cheques, 26000);
  assert.equal(s.customers.aging().length, 0);

  // The cheque bounces: the cheque and its discount come back on the balance.
  s.auth.logout(); s.auth.login({ username: 'admin', pin: '1234' });
  const chq = s.customers.cheques({})[0];
  assert.equal(chq.cheque_no, 'CH-77');
  const after = s.customers.bounceCheque({ id: chq.id, reason: 'insufficient funds' });
  assert.equal(after.balance, 30000);
  const st = s.customers.statement({ id: cust });
  assert.ok(st.rows.some((r) => r.kind === 'bounced' && r.debit === 26000));
  assert.equal(st.balance, 30000);

  // Overpaying leaves an advance that settles the next credit sale.
  const r3 = s.customers.collect({ customerId: cust, amount: 50000, method: 'cash' });
  assert.equal(r3.customer.balance, -20000);
  assert.equal(s.customers.openInvoices(cust).advance, 20000);
  const inv3 = s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 1 }], payments: [] });
  assert.equal(s.orders.get(inv3.id).open_amount, 0);
  assert.equal(s.customers.get(cust).balance, -10000);

  // Voiding a receipt needs a reason; the money leaves the drawer total.
  const cashBefore = s.shifts.summary().expectedCash;
  assert.equal(tryCode(() => s.customers.voidReceipt({ receiptNo: r3.receipt.receipt_no })), 'REASON_REQUIRED');
  const v = s.customers.voidReceipt({ receiptNo: r3.receipt.receipt_no, reason: 'wrong customer' });
  assert.equal(v.status, 'void');
  assert.equal(v.customer.balance, 40000);
  assert.equal(s.shifts.summary().expectedCash, cashBefore - 50000);
  assert.equal(tryCode(() => s.customers.voidReceipt({ receiptNo: r3.receipt.receipt_no, reason: 'x' })), 'ALREADY_VOID');
  const list = s.customers.receipts({});
  assert.equal(list.rows.length, 3);
  assert.equal(list.totals.amount, 20000); // posted only: receipt 1 (cheque bounced, receipt 3 void)
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'receipt_void'").get());
});

test('trading terms: customer discount, purchase bonus and line discount, supplier rebates', () => {
  const { s, db } = setup({ tax_rate: 0 });
  const sup = s.suppliers.save({ name: 'Delta Foods' });
  const p = s.products.save({ name: 'Oil', price: 10000, cost: 0, stock: 0 });
  // 10 cartons-worth bought at 60 with 10% off, plus 2 free: 540 for 12 units → 45 each
  const pur = s.purchases.create({ supplierId: sup, items: [{ product_id: p, qty: 10, unit_cost: 6000, discount_percent: 10, bonus_qty: 2 }] });
  assert.equal(pur.total, 54000);
  const prod = db.prepare('SELECT stock, cost, supplier_id FROM products WHERE id = ?').get(p);
  assert.deepEqual([prod.stock, prod.cost, prod.supplier_id], [12, 4500, sup]);
  // returning 2 units credits 2 × 45
  s.purchases.returnItems({ purchaseId: pur.id, items: [{ purchase_item_id: pur.items[0].id, qty: 2 }] });
  assert.equal(db.prepare('SELECT returned FROM purchases WHERE id = ?').get(pur.id).returned, 9000);

  // Standing 10% customer discount: automatic, not the cashier's discount, kept apart on the line.
  const cust = s.customers.save({ name: 'Wholesaler', discount_percent: 10 });
  s.users.save({ name: 'Cash', username: 'cash', pin: '1111', role: 'cashier' });
  s.auth.logout(); s.auth.login({ username: 'cash', pin: '1111' });
  s.shifts.open({});
  const q = s.orders.quote({ customer_id: cust, items: [{ product_id: p, qty: 5 }] });
  assert.equal(q.lines[0].customer_discount, 5000);
  assert.equal(q.total, 45000);
  const o = s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 5 }], payments: [{ method: 'cash', amount: 45000 }] });
  assert.equal(o.items[0].customer_discount, 5000);
  s.auth.logout(); s.auth.login({ username: 'admin', pin: '1234' });

  // Rebates: 5% of purchases once 500 is reached; sales-based on the supplier's products.
  const today = new Date().toLocaleDateString('en-CA');
  const r1 = s.rebates.save({ supplier_id: sup, name: 'Q4 purchases', basis: 'purchases', start_date: today, end_date: today, target: 40000, percent: 5 });
  const r2 = s.rebates.save({ supplier_id: sup, name: 'Q4 sales', basis: 'sales', start_date: today, end_date: today, target: 100000, percent: 3 });
  const [a, b] = [s.rebates.list({}).find((x) => x.id === r1), s.rebates.list({}).find((x) => x.id === r2)];
  assert.deepEqual([a.achieved, a.reached, a.earned], [45000, true, 2250]);
  assert.deepEqual([b.achieved, b.reached, b.earned, b.progress], [45000, false, 0, 45]);
  const balanceBefore = s.suppliers.list({}).find((x) => x.id === sup).balance;
  s.rebates.settle({ id: r1 });
  assert.equal(s.suppliers.list({}).find((x) => x.id === sup).balance, balanceBefore - 2250);
  assert.equal(tryCode(() => s.rebates.settle({ id: r1 })), 'INVALID_STATUS');
  const rep = s.reports.summary({});
  assert.equal(rep.totals.rebates, 2250);
});

test('restaurant floor: guests, transfer, merge, split bill, printed check', () => {
  const { s, db } = setup({ business_type: 'restaurant', tax_rate: 0, service_rate: 0 });
  const [t1, t2, t3] = s.tables.list().map((x) => x.id);
  const burger = s.products.save({ name: 'Burger', price: 10000, kitchen: true, track_stock: false });
  const cola = s.products.save({ name: 'Cola', price: 2000, track_stock: false });
  s.shifts.open({});
  const a = s.orders.saveOpen({ order_type: 'dine_in', table_id: t1, guests: 3, items: [{ product_id: burger, qty: 3 }, { product_id: cola, qty: 3 }] });
  const b = s.orders.saveOpen({ order_type: 'dine_in', table_id: t2, guests: 2, items: [{ product_id: cola, qty: 2 }] });
  const tl = s.tables.list().find((x) => x.id === t1);
  assert.deepEqual([tl.guests, tl.order_total, tl.unsent], [3, 36000, 1]);
  // transfer table 1 → table 3; a busy table is refused
  assert.equal(tryCode(() => s.floor.transfer({ orderId: a.id, tableId: t2 })), 'TABLE_BUSY');
  s.floor.transfer({ orderId: a.id, tableId: t3 });
  assert.equal(s.tables.list().find((x) => x.id === t1).order_id, null);
  // merge table 2 into table 3
  const merged = s.floor.merge({ fromId: b.id, toId: a.id });
  assert.equal(merged.total, 40000);
  assert.equal(merged.guests, 5);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(b.id).status, 'void');
  // split: one burger and two colas go on their own bill
  const burgerLine = merged.items.find((i) => i.product_id === burger);
  const colaLine = merged.items.find((i) => i.product_id === cola);
  const part = s.floor.split({ orderId: a.id, items: [{ order_item_id: burgerLine.id, qty: 1 }, { order_item_id: colaLine.id, qty: 2 }] });
  assert.equal(part.total, 14000);
  assert.equal(s.orders.get(a.id).total, 26000);
  const paid = s.orders.checkout({ ...part, items: part.items.map((i) => ({ id: i.id, product_id: i.product_id, qty: i.qty })), payments: [{ method: 'cash', amount: 14000 }] });
  assert.equal(paid.status, 'completed');
  // printed check marks the table
  s.floor.printCheck(a.id);
  assert.ok(s.tables.list().find((x) => x.id === t3).check_printed_at);
});

test('kitchen: stations by product/category, tickets on send and on payment, display flow, void cancels', () => {
  const { s, db } = setup({ business_type: 'restaurant', tax_rate: 0, service_rate: 0 });
  const grill = s.kitchenStations.save({ name: 'Grill', printer_name: 'GRILL-80' });
  const bar = s.kitchenStations.save({ name: 'Bar', copies: 2 });
  const food = s.categories.save({ name: 'Food' });
  const drinks = s.categories.save({ name: 'Drinks' });
  s.kitchenStations.setCategory({ categoryId: drinks, stationId: bar });
  const burger = s.products.save({ name: 'Burger', price: 10000, kitchen: true, track_stock: false, category_id: food });
  const juice = s.products.save({ name: 'Juice', price: 3000, kitchen: true, track_stock: false, category_id: drinks });
  const water = s.products.save({ name: 'Water', price: 500, kitchen: false, track_stock: false });
  s.shifts.open({});
  const [t1] = s.tables.list().map((x) => x.id);
  const o = s.orders.saveOpen({ order_type: 'dine_in', table_id: t1, items: [{ product_id: burger, qty: 2, note: 'no onion' }, { product_id: juice, qty: 1 }, { product_id: water, qty: 1 }] });
  const sent = s.orders.sendToKitchen(o.id);
  assert.deepEqual(sent.tickets.map((tk) => [tk.station.name, tk.items.map((i) => `${i.qty}x${i.name}`).join()]), [['Grill', '2xBurger'], ['Bar', '1xJuice']]);
  assert.equal(s.orders.sendToKitchen(o.id).tickets.length, 0); // nothing new
  // the display (no sign-in needed) moves tickets along
  const key = s.kds.ensureKey();
  assert.equal(key.length, 8);
  assert.equal(s.kds.ensureKey(), key);
  s.settings.save({ kds_key: 'HACKED', business_name: 'x' });
  assert.equal(s.kds.ensureKey(), key);
  let st = s.kds.state({});
  assert.equal(st.tickets.length, 2);
  assert.equal(s.kds.state({ stationId: bar }).tickets.length, 1);
  const grillTicket = st.tickets.find((tk) => tk.station_id === grill);
  s.kds.bump({ id: grillTicket.id }); s.kds.bump({ id: grillTicket.id });
  assert.equal(s.tables.list().find((x) => x.id === t1).ready, 1);
  s.kds.bump({ id: grillTicket.id });
  assert.equal(s.kds.state({}).tickets.length, 1);
  assert.equal(s.kds.recall({}), true);
  assert.equal(s.kds.state({}).tickets.length, 2);
  // takeaway paid at once still reaches the kitchen
  const paid = s.orders.checkout({ order_type: 'takeaway', items: [{ product_id: burger, qty: 1 }], payments: [{ method: 'cash', amount: 10000 }] });
  assert.equal(paid.kitchen_tickets.length, 1);
  // voiding an order clears its tickets from the screen
  const o2 = s.orders.saveOpen({ order_type: 'takeaway', items: [{ product_id: juice, qty: 3 }] });
  s.orders.sendToKitchen(o2.id);
  s.orders.voidOpen({ id: o2.id });
  assert.ok(!s.kds.state({}).tickets.some((tk) => tk.order_id === o2.id));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kitchen_tickets WHERE status = ?').get('cancelled').n, 1);
});

test('scale barcodes: weight and price labels find the product by PLU', () => {
  const { s } = setup({ tax_rate: 0, scale_barcodes: true });
  const cheese = s.products.save({ name: 'Roumy cheese', price: 32000, by_weight: true, plu: '00123', unit: 'kg', stock: 20 });
  // 21 + 00123 + 01250 (1.250 kg) + check digit
  const w = s.products.byBarcode('2100123012507');
  assert.equal(w.id, cheese);
  assert.equal(w.scale.qty, 1.25);
  assert.equal(s.products.byBarcode('2100999012507'), null); // unknown PLU
  // price labels: 21 + 00123 + 08000 (80.00) → 0.25 kg at 320/kg
  s.settings.save({ scale_value: 'price', scale_value_decimals: 2 });
  assert.equal(s.products.byBarcode('2100123080001').scale.qty, 0.25);
  // turned off: a normal barcode lookup
  s.settings.save({ scale_barcodes: false });
  assert.equal(s.products.byBarcode('2100123012507'), null);
  s.shifts.open({});
  s.settings.save({ scale_barcodes: true, scale_value: 'weight', scale_value_decimals: 3 });
  const o = s.orders.checkout({ items: [{ product_id: cheese, qty: s.products.byBarcode('2100123012507').scale.qty }], payments: [{ method: 'cash', amount: 40000 }] });
  assert.equal(o.total, 40000);
});

test('purchase orders from low stock, receiving them, dashboard, drawer permission', () => {
  const { s, db } = setup({ tax_rate: 0 });
  const sup = s.suppliers.save({ name: 'Nile Foods', phone: '01110000000' });
  const rice = s.products.save({ name: 'Rice', price: 3000, cost: 2000, stock: 0, min_stock: 10 });
  s.purchases.create({ supplierId: sup, items: [{ product_id: rice, qty: 4, unit_cost: 2000 }] }); // links the supplier, stock 4
  s.products.save({ name: 'Salt', price: 500, stock: 50, min_stock: 5 });
  const groups = s.purchaseOrders.suggest();
  assert.equal(groups.length, 1);
  assert.deepEqual([groups[0].supplier_id, groups[0].items[0].name, groups[0].items[0].qty], [sup, 'Rice', 16]);
  const po = s.purchaseOrders.save({ supplier_id: sup, items: groups[0].items });
  assert.equal(po.po_no, 1);
  assert.equal(po.total, 32000);
  s.purchaseOrders.setStatus({ id: po.id, status: 'sent' });
  s.purchases.create({ supplierId: sup, poId: po.id, items: [{ product_id: rice, qty: 16, unit_cost: 2000 }] });
  assert.equal(s.purchaseOrders.get(po.id).status, 'received');
  assert.equal(tryCode(() => s.purchaseOrders.setStatus({ id: po.id, status: 'cancelled' })), 'INVALID_STATUS');
  assert.equal(s.purchaseOrders.suggest().length, 0);
  // dashboard
  s.shifts.open({ openingCash: 1000 });
  s.orders.checkout({ items: [{ product_id: rice, qty: 2 }], payments: [{ method: 'cash', amount: 6000 }] });
  const d = s.reports.dashboard();
  assert.deepEqual([d.today.total, d.today.orders, d.today.profit, d.shift.expectedCash], [6000, 1, 2000, 7000]);
  assert.equal(d.lowStockCount, 0);
  // opening the drawer without a sale: cashiers need a supervisor
  s.users.save({ name: 'Cash', username: 'cash', pin: '1111', role: 'cashier' });
  s.users.save({ name: 'Sup', username: 'sup', pin: '2222', role: 'supervisor' });
  s.auth.logout(); s.auth.login({ username: 'cash', pin: '1111' });
  assert.equal(tryCode(() => s.drawer.authorize({})), 'APPROVAL_REQUIRED');
  assert.equal(s.drawer.authorize({ approval: { username: 'sup', pin: '2222' } }), true);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'drawer_open' AND approved_by IS NOT NULL").get());
});

test('restaurant: sizes and extras, recipes consume ingredients, delivery zones and drivers', () => {
  const { s, db } = setup({ business_type: 'restaurant', tax_rate: 0, service_rate: 0 });
  const bread = s.products.save({ name: 'Bread', price: 0, cost: 200, stock: 100, is_ingredient: true });
  const chicken = s.products.save({ name: 'Chicken (kg)', price: 0, cost: 20000, stock: 10, unit: 'kg', is_ingredient: true });
  const cheese = s.products.save({ name: 'Cheese (kg)', price: 0, cost: 30000, stock: 5, unit: 'kg', is_ingredient: true });
  const size = s.modifiers.save({ name: 'Size', min_select: 1, max_select: 1, options: [{ name: 'Regular', price: 0 }, { name: 'Large', price: 2000 }] });
  const extras = s.modifiers.save({ name: 'Extras', min_select: 0, max_select: 0, options: [{ name: 'Extra cheese', price: 1000, ingredient_id: cheese, ingredient_qty: 0.05 }, { name: 'No onion', price: 0 }] });
  const sandwich = s.products.save({ name: 'Chicken sandwich', price: 8000, track_stock: false, kitchen: true, modifier_group_ids: [size, extras], recipe: [{ ingredient_id: bread, qty: 1 }, { ingredient_id: chicken, qty: 0.15 }] });
  const groups = s.modifiers.forProduct(sandwich);
  assert.deepEqual(groups.map((g) => g.name), ['Size', 'Extras']);
  const [regular, large] = groups[0].options; const [extraCheese, noOnion] = groups[1].options;
  assert.equal(s.products.list({ forSale: true }).some((p) => p.id === bread), false);
  assert.equal(s.products.get(sandwich).recipe_cost, 200 + 3000);
  s.shifts.open({});
  // size is required
  assert.equal(tryCode(() => s.orders.quote({ items: [{ product_id: sandwich, qty: 1 }] })), 'MODIFIERS_REQUIRED');
  assert.equal(tryCode(() => s.orders.quote({ items: [{ product_id: sandwich, qty: 1, modifiers: [regular.id, large.id] }] })), 'MODIFIERS_REQUIRED');
  const q = s.orders.quote({ items: [{ product_id: sandwich, qty: 2, modifiers: [large.id, extraCheese.id, noOnion.id] }] });
  assert.equal(q.lines[0].unit_price, 11000);
  assert.equal(q.total, 22000);
  // delivery with a zone fee, driver, then paid on return
  const zone = s.delivery.saveZone({ name: 'Downtown', fee: 1500 });
  const driver = s.delivery.saveDriver({ name: 'Mido', phone: '0100' });
  const o = s.orders.saveOpen({ order_type: 'delivery', zone_id: zone, customer_name: 'Ali', customer_address: '5 Nile St', items: [{ product_id: sandwich, qty: 2, modifiers: [large.id, extraCheese.id, noOnion.id] }] });
  assert.equal(o.total, 23500);
  assert.equal(o.delivery_fee, 1500);
  const sent = s.orders.sendToKitchen(o.id);
  assert.match(sent.tickets[0].items[0].note, /Large/);
  assert.equal(s.delivery.board().waiting.length, 1);
  s.delivery.dispatch({ orderId: o.id, driverId: driver });
  assert.equal(s.delivery.board().out.length, 1);
  const paid = s.orders.checkout({ ...s.orders.get(o.id), items: s.orders.get(o.id).items.map((i) => ({ id: i.id, product_id: i.product_id, qty: i.qty, modifiers: i.modifiers })), payments: [{ method: 'cash', amount: 23500 }] });
  assert.equal(paid.delivery_status, 'delivered');
  assert.equal(paid.items[0].unit_cost, 200 + 3000 + 1500);
  // ingredients consumed: 2 breads, 0.3 kg chicken, 0.1 kg cheese
  const stock = (id) => Math.round(db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock * 1000) / 1000;
  assert.deepEqual([stock(bread), stock(chicken), stock(cheese)], [98, 9.7, 4.9]);
  const rep = s.delivery.drivers_report({});
  assert.deepEqual([rep[0].name, rep[0].orders, rep[0].cash, rep[0].fees], ['Mido', 1, 23500, 1500]);
  // returning one sandwich puts its ingredients back
  s.orders.refund({ orderId: paid.id, items: [{ order_item_id: paid.items[0].id, qty: 1 }] });
  assert.deepEqual([stock(bread), stock(chicken), stock(cheese)], [99, 9.85, 4.95]);
});

test('treasury: cash box and bank, transfers, receipts into the bank, cheques both ways, shift deposit', () => {
  const { s } = setup({ tax_rate: 0 });
  const box = s.treasury.saveAccount({ name: 'Main safe', kind: 'cash', opening_balance: 100000 });
  const bank = s.treasury.saveAccount({ name: 'NBE current', kind: 'bank', bank_name: 'NBE', opening_balance: 500000 });
  const bal = (id) => s.treasury.accounts().find((a) => a.id === id).balance;
  s.treasury.transfer({ fromId: box, toId: bank, amount: 40000, notes: 'deposit' });
  assert.deepEqual([bal(box), bal(bank)], [60000, 540000]);
  assert.equal(tryCode(() => s.treasury.adjust({ accountId: bank, amount: -500 })), 'REASON_REQUIRED');
  s.treasury.adjust({ accountId: bank, amount: -500, notes: 'bank fees' });
  // a customer pays by bank transfer into the bank; a cheque clears into the bank, then bounces
  const p = s.products.save({ name: 'Box', price: 10000, stock: 100 });
  const cust = s.customers.save({ name: 'Delta' });
  s.shifts.open({ openingCash: 5000 });
  s.orders.checkout({ customer_id: cust, items: [{ product_id: p, qty: 5 }], payments: [] });
  const r1 = s.customers.collect({ customerId: cust, amount: 20000, method: 'bank', accountId: bank });
  assert.equal(bal(bank), 559500);
  s.customers.collect({ customerId: cust, amount: 30000, method: 'cheque', cheque: { no: 'C1', due: '2026-12-01' } });
  const chq = s.customers.cheques({})[0];
  s.customers.clearCheque({ id: chq.id, accountId: bank });
  assert.equal(bal(bank), 589500);
  s.customers.bounceCheque({ id: chq.id, reason: 'no funds' });
  assert.equal(bal(bank), 559500);
  s.customers.voidReceipt({ receiptNo: r1.receipt.receipt_no, reason: 'wrong' });
  assert.equal(bal(bank), 539500);
  // supplier: paid from the safe, then by a cheque charged to the bank when cashed, another cancelled
  const sup = s.suppliers.save({ name: 'Nile' });
  s.purchases.create({ supplierId: sup, items: [{ product_id: p, qty: 10, unit_cost: 6000 }] }); // owes 600
  s.suppliers.pay({ supplierId: sup, amount: 10000, method: 'cash', accountId: box });
  assert.equal(bal(box), 50000);
  s.suppliers.pay({ supplierId: sup, amount: 30000, method: 'cheque', cheque: { no: 'OUT-1', bank: 'NBE', due: '2026-11-15' }, accountId: bank });
  s.suppliers.pay({ supplierId: sup, amount: 5000, method: 'cheque', cheque: { no: 'OUT-2' } });
  const balanceOf = () => s.suppliers.list({}).find((x) => x.id === sup).balance;
  assert.equal(balanceOf(), 60000 - 10000 - 30000 - 5000);
  assert.equal(bal(bank), 539500); // not cashed yet
  const out = s.treasury.issuedCheques({});
  assert.equal(out.length, 2);
  s.treasury.clearIssued({ id: out.find((c) => c.cheque_no === 'OUT-1').id });
  assert.equal(bal(bank), 509500);
  s.treasury.voidIssued({ id: out.find((c) => c.cheque_no === 'OUT-2').id, reason: 'lost' });
  assert.equal(balanceOf(), 20000);
  // expense from the bank; shift takings deposited into the safe
  const e = s.expenses.create({ category: 'Rent', amount: 9500, fromDrawer: false, accountId: bank });
  assert.equal(bal(bank), 500000);
  s.expenses.remove(e.id);
  assert.equal(bal(bank), 509500);
  s.shifts.close({ countedCash: 5000, depositAccountId: box, depositAmount: 4000 });
  assert.equal(bal(box), 54000);
  const st = s.treasury.statement({ id: bank });
  assert.equal(st.rows.at(-1).balance, 509500);
  const ov = s.treasury.overview();
  assert.deepEqual([ov.cash, ov.bank, ov.chequesOut.n], [54000, 509500, 0]);
});
