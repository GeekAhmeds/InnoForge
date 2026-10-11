'use strict';
// Egyptian e-invoice / e-receipt: canonical serialization, documents built from sales, the
// queue, and the submitter against a fake ETA (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../electron/db.cjs');
const { createServices } = require('../electron/services/index.cjs');
const eta = require('../electron/eta.cjs');
const { createEtaSubmitter } = require('../electron/eta-submitter.cjs');

const tryCode = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

function shop(extra = {}) {
  const db = openDatabase(':memory:');
  const s = createServices(db);
  s.auth.setup({ business: { business_name: 'Shop', business_type: 'trading', tax_rate: 14, prices_include_tax: false }, admin: { name: 'A', username: 'admin', pin: '1234' } });
  s.auth.login({ username: 'admin', pin: '1234' });
  s.settings.save({
    eta_enabled: true, eta_invoice: true, eta_receipt: true, eta_rin: '123456789', eta_name: 'Shop LLC', eta_activity: '4711',
    eta_governate: 'Cairo', eta_city: 'Nasr City', eta_street: 'Abbas', eta_building: '5', eta_item_code: 'EG-123456789-1',
    eta_client_id: 'erp-id', eta_client_secret: 'erp-secret', eta_pos_serial: 'POS-1', eta_pos_client_id: 'pos-id', eta_pos_client_secret: 'pos-secret', eta_pos_key: 'psk',
    eta_signer: 'url', eta_signer_url: 'http://signer.local/sign', ...extra,
  });
  s.shifts.open({});
  const pen = s.products.save({ name: 'Pen', price: 1000, cost: 500, stock: 100, eta_item_type: 'GS1', eta_item_code: '6221234567890' });
  const book = s.products.save({ name: 'Book', price: 2550, cost: 1000, stock: 100 });
  return { db, s, pen, book };
}

test('eta: canonical serialization (property names upper case, arrays repeat the name)', () => {
  assert.equal(eta.serialize({ issuer: { address: { branchID: '0' } }, total: 1.5 }), '"ISSUER""ADDRESS""BRANCHID""0""TOTAL""1.5"');
  assert.equal(eta.serialize({ lines: [{ a: 1 }, { a: 2 }], e: [] }), '"LINES""LINES""A""1""LINES""A""2""E"');
});

test('eta: settings secrets never reach the window; the device keeps its own POS registration', () => {
  const { s, db } = shop();
  const out = s.settings.get();
  assert.equal(out.eta_client_secret, '');
  assert.equal(out.eta_client_secret_set, true);
  // Saving the form without the secret keeps it.
  s.settings.save({ eta_client_secret: '', eta_name: 'Shop Co' });
  assert.equal(s.etaQueue.settings('local').eta_client_secret, 'erp-secret');
  assert.equal(db.prepare("SELECT value FROM device_settings WHERE device_id = 'local' AND key = 'eta_pos_serial'").get().value, 'POS-1');
  assert.equal(tryCode(() => s.settings.save({ eta_env: 'live' })), 'INVALID_SETTING');
});

test('eta: an invoice for a company and a receipt for a walk-in customer, totals consistent', () => {
  const { s, pen, book } = shop();
  const co = s.customers.save({ name: 'Buyer Co', tax_number: '987654321', eta: { type: 'B', governate: 'Giza', regionCity: 'Dokki', street: 'Tahrir', buildingNumber: '9' } });
  const o1 = s.orders.checkout({ customer_id: co, discount: 300, items: [{ product_id: pen, qty: 3, discount: 100 }, { product_id: book, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] });
  const o2 = s.orders.checkout({ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 100000 }] });
  const docs = s.eta.list();
  assert.deepEqual(docs.map((d) => [d.kind, d.doc_type, d.status]).reverse(), [['invoice', 'I', 'pending'], ['receipt', 'S', 'pending']]);

  s.etaQueue.prepare();
  const inv = s.etaQueue.ready('invoice')[0].payload;
  assert.equal(inv.issuer.id, '123456789');
  assert.equal(inv.receiver.type, 'B');
  assert.equal(inv.receiver.id, '987654321');
  assert.equal(inv.internalID, String(o1.invoice_no));
  assert.equal(inv.invoiceLines[0].itemType, 'GS1');
  assert.equal(inv.invoiceLines[1].itemCode, 'EG-123456789-1'); // the general code
  // Lines add up, and match the sale (net and tax within a piaster of rounding).
  const sum = (k) => Math.round(inv.invoiceLines.reduce((t, l) => t + l[k], 0) * 1e5) / 1e5;
  assert.equal(inv.totalSalesAmount, sum('salesTotal'));
  assert.equal(inv.netAmount, sum('netTotal'));
  assert.ok(Math.abs(inv.netAmount - (o1.total - o1.tax) / 100) < 0.011);
  assert.ok(Math.abs(inv.taxTotals[0].amount - o1.tax / 100) < 0.011);
  for (const l of inv.invoiceLines) assert.equal(Math.round((l.salesTotal - l.discount.amount) * 1e5) / 1e5, l.netTotal);

  const rec = s.etaQueue.ready('receipt')[0].payload;
  assert.equal(rec.header.receiptNumber, String(o2.invoice_no));
  assert.equal(rec.seller.deviceSerialNumber, 'POS-1');
  assert.equal(rec.header.uuid, eta.receiptUuid(rec));
  assert.match(rec.header.uuid, /^[0-9a-f]{64}$/);
  assert.equal(rec.header.previousUUID, '');
  // The next receipt from this computer points at the previous one.
  s.orders.checkout({ items: [{ product_id: book, qty: 2 }], payments: [{ method: 'cash', amount: 100000 }] });
  s.etaQueue.prepare();
  const [, second] = s.etaQueue.ready('receipt');
  assert.equal(second.payload.header.previousUUID, rec.header.uuid);
});

test('eta: missing settings stop the document with a clear reason; retry and skip', () => {
  const { s, pen } = shop({ eta_receipt: false });
  s.settings.save({ eta_activity: '' });
  const o = s.orders.checkout({ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] });
  s.etaQueue.prepare();
  const [d] = s.eta.list();
  assert.equal(d.status, 'error');
  assert.match(d.error, /ETA_MISSING: eta_activity/);
  s.settings.save({ eta_activity: '4711' });
  s.eta.retry(d.id);
  s.etaQueue.prepare();
  assert.equal(s.etaQueue.ready('invoice').length, 1);
  s.eta.skip(d.id);
  assert.equal(s.eta.get(d.id).status, 'skipped');
  // An older sale can be queued again by its number, only once.
  s.eta.retry(d.id);
  assert.equal(tryCode(() => s.eta.add({ invoiceNo: o.invoice_no })), 'ETA_ALREADY_QUEUED');
});

test('eta: submitter logs in, signs, submits, follows validation; returns become credit notes', async () => {
  const { s, pen } = shop({ eta_receipt: false });
  const o = s.orders.checkout({ items: [{ product_id: pen, qty: 2 }], payments: [{ method: 'cash', amount: 5000 }] });
  const calls = [];
  const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
    if (url.endsWith('/connect/token')) return reply(200, { access_token: 'tok', expires_in: 3600 });
    if (url === 'http://signer.local/sign') return reply(200, { signature: 'SIGNED' });
    if (url.endsWith('/api/v1/documentsubmissions')) {
      const docs = JSON.parse(opts.body).documents;
      return reply(202, { submissionId: 'SUB1', acceptedDocuments: docs.map((d, i) => ({ uuid: `UUID${d.internalID}`, longId: `L${i}`, internalId: d.internalID })), rejectedDocuments: [] });
    }
    if (url.includes('/api/v1/documents/')) return reply(200, { status: 'Valid' });
    return reply(404, {});
  };
  const sub = createEtaSubmitter({ queue: s.etaQueue, fetchImpl: fakeFetch });
  await sub.run();
  const token = calls.find((c) => c.url.endsWith('/connect/token'));
  assert.equal(token.url, 'https://id.preprod.eta.gov.eg/connect/token');
  assert.match(token.body, /client_id=erp-id/);
  const submitted = JSON.parse(calls.find((c) => c.url.endsWith('/documentsubmissions')).body).documents[0];
  assert.deepEqual(submitted.signatures, [{ signatureType: 'I', value: 'SIGNED' }]);
  const signerBody = JSON.parse(calls.find((c) => c.url === 'http://signer.local/sign').body);
  const unsigned = { ...submitted };
  delete unsigned.signatures;
  assert.equal(signerBody.serialized, eta.serialize(unsigned));
  let [d] = s.eta.list();
  assert.equal(d.status, 'valid');
  assert.equal(d.uuid, `UUID${o.invoice_no}`);
  assert.equal(d.long_id, 'L0');

  // A return of the sale is a credit note pointing at the original.
  s.orders.refund({ orderId: o.id, items: [{ order_item_id: s.orders.get(o.id).items[0].id, qty: 1 }] });
  await sub.run();
  [d] = s.eta.list();
  assert.equal(d.doc_type, 'C');
  assert.equal(d.status, 'valid');
  const credit = s.eta.get(d.id).payload;
  assert.deepEqual(credit.references, [`UUID${o.invoice_no}`]);
  assert.equal(credit.documentType, 'C');

  // ETA rejects: the reason is kept.
  const o2 = s.orders.checkout({ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] });
  const rejecting = createEtaSubmitter({
    queue: s.etaQueue,
    fetchImpl: async (url, opts) => (url.endsWith('/documentsubmissions')
      ? reply(202, { submissionId: 'SUB2', acceptedDocuments: [], rejectedDocuments: [{ internalId: String(o2.invoice_no), error: { message: 'Validation Error', details: [{ message: 'Invalid item code' }] } }] })
      : fakeFetch(url, opts)),
  });
  await rejecting.run();
  [d] = s.eta.list();
  assert.equal(d.status, 'rejected');
  assert.match(d.error, /Invalid item code/);
});

test('eta: receipts go out per computer with the POS headers; offline leaves them queued', async () => {
  const { s, pen } = shop({ eta_invoice: false });
  s.orders.checkout({ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] });
  const offline = createEtaSubmitter({ queue: s.etaQueue, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await offline.run();
  assert.equal(r.last.ok, false);
  assert.equal(s.eta.list()[0].status, 'pending');

  const calls = [];
  const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
  const sub = createEtaSubmitter({
    queue: s.etaQueue,
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url, headers: opts.headers, body: opts.body });
      if (url.endsWith('/connect/token')) return reply(200, { access_token: 'tok', expires_in: 3600 });
      if (url.endsWith('/receiptsubmissions')) {
        const receipts = JSON.parse(opts.body).receipts;
        return reply(202, { submissionId: 'RS1', acceptedDocuments: receipts.map((x) => ({ uuid: x.header.uuid, receiptNumber: x.header.receiptNumber })), rejectedDocuments: [] });
      }
      if (url.includes('/receiptsubmissions/RS1/details')) return reply(200, { status: 'Valid', receipts: [{ uuid: s.eta.list()[0].uuid, status: 'Valid' }] });
      return reply(404, {});
    },
  });
  await sub.run();
  const tok = calls.find((c) => c.url.endsWith('/connect/token'));
  assert.equal(tok.headers.posserial, 'POS-1');
  assert.equal(tok.headers.presharedkey, 'psk');
  assert.match(tok.body, /client_id=pos-id/);
  assert.equal(s.eta.list()[0].status, 'valid');
  assert.equal(s.eta.summary().counts.valid, 1);
});
