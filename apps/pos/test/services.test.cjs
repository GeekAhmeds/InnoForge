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
  db.prepare("UPDATE orders SET completed_at = datetime('now', 'localtime', '-45 days') WHERE id = ?").run(o.id);
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
