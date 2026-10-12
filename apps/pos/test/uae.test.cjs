'use strict';
// UAE e-invoicing (PINT AE): documents built from B2B sales and returns, consumers left out,
// and the hand-over to the service provider against a fake ASP (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../electron/db.cjs');
const { createServices } = require('../electron/services/index.cjs');
const { entitlements } = require('../electron/editions.cjs');
const U = require('../electron/uae.cjs');
const { createUaeSubmitter } = require('../electron/uae-submitter.cjs');

const tryCode = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

function uaeShop() {
  const db = openDatabase(':memory:');
  const s = createServices(db, { entitlements: () => entitlements({ edition: 'trading', country: 'AE' }) });
  s.auth.setup({ business: { business_name: 'Al Noor', business_type: 'trading', country: 'AE', currency: 'AED', tax_rate: 5, prices_include_tax: true, tax_number: '100123456700003' }, admin: { name: 'A', username: 'admin', pin: '1234' } });
  s.auth.login({ username: 'admin', pin: '1234' });
  s.settings.save({ uae_name: 'Al Noor Trading LLC', uae_tl: 'CN-1234567', uae_tl_authority: 'DED Dubai', uae_street: 'Sheikh Zayed Rd', uae_city: 'Dubai', uae_emirate: 'DXB', uae_enabled: true });
  s.shifts.open({});
  const item = s.products.save({ name: 'Laptop bag', price: 10500, cost: 5000, stock: 100 });
  const company = s.customers.save({ name: 'Buyer & Co LLC', tax_number: '100765432100003', uae: { street: 'Corniche', city: 'Abu Dhabi', emirate: 'AUH', tl: 'TL-998', reference: 'PO-77' } });
  return { db, s, item, company };
}

test('uae: B2B sales and returns become PINT AE documents; consumers are left out', () => {
  const { db, s, item, company } = uaeShop();
  s.orders.checkout({ items: [{ product_id: item, qty: 1 }], payments: [{ method: 'cash', amount: 10500 }] }); // a consumer
  const o = s.orders.checkout({ customer_id: company, items: [{ product_id: item, qty: 2 }], payments: [{ method: 'card', amount: 21000 }] });
  s.orders.refund({ orderId: o.id, items: [{ order_item_id: o.items[0].id, qty: 1 }], reason: 'damaged' });
  const docs = db.prepare('SELECT * FROM uae_documents ORDER BY id').all();
  assert.deepEqual(docs.map((d) => [d.kind, d.doc_no]), [['invoice', String(o.invoice_no)], ['credit', `${o.invoice_no}-R1`]]);
  const inv = docs[0].xml;
  assert.match(inv, /<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1<\/cbc:CustomizationID>/);
  assert.match(inv, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/);
  assert.match(inv, /<cbc:EndpointID schemeID="0235">1001234567<\/cbc:EndpointID>/); // seller TIN
  assert.match(inv, /<cbc:EndpointID schemeID="0235">1007654321<\/cbc:EndpointID>/); // buyer TIN
  assert.match(inv, /<cbc:CountrySubentity>AUH<\/cbc:CountrySubentity>/);
  assert.match(inv, /Buyer &amp; Co LLC/);
  assert.match(inv, /<cbc:TaxAmount currencyID="AED">10.00<\/cbc:TaxAmount>/); // 210 incl. 5% = 200 + 10
  assert.match(inv, /<cbc:PayableAmount currencyID="AED">210.00<\/cbc:PayableAmount>/);
  assert.match(inv, /<cbc:PaymentMeansCode>48<\/cbc:PaymentMeansCode>/);
  assert.match(docs[1].xml, /^<\?xml[^>]*>\n<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/);
  assert.match(docs[1].xml, /<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>\d+<\/cbc:ID><cbc:IssueDate>/);
  assert.match(docs[1].xml, /<cbc:CreditedQuantity unitCode="C62">1<\/cbc:CreditedQuantity>/);
  // A buyer without a TRN, address or emirate gets no e-invoice.
  assert.equal(U.b2bBuyer({ name: 'x', tax_number: '123', uae: { street: 'a', city: 'b', emirate: 'DXB' } }), null);
  assert.equal(tryCode(() => s.settings.save({ uae_emirate: 'XXX' })), 'INVALID_SETTING');
});

test('uae: hand-over to the ASP (sent, rejected, offline) and export mode', async () => {
  const { db, s, item, company } = uaeShop();
  s.orders.checkout({ customer_id: company, items: [{ product_id: item, qty: 1 }], payments: [{ method: 'cash', amount: 10500 }] });
  s.orders.checkout({ customer_id: company, items: [{ product_id: item, qty: 3 }], payments: [{ method: 'cash', amount: 31500 }] });
  const [d1, d2] = db.prepare('SELECT * FROM uae_documents ORDER BY id').all();
  // Export mode: the submitter sends nothing.
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return init.body === d2.xml ? { ok: false, status: 422, text: async () => 'buyer endpoint unknown' } : { ok: true, status: 202, text: async () => '{"id":"asp-1"}' }; };
  assert.deepEqual(await createUaeSubmitter({ queue: s.uaeQueue, fetchImpl }).run(), { sent: 0, rejected: 0 });
  s.settings.save({ uae_mode: 'asp', uae_asp_url: 'https://asp.example/v1/documents', uae_asp_header: 'X-Api-Key', uae_asp_key: 'k-123' });
  assert.equal(s.settings.get().uae_asp_key, ''); // secret
  assert.deepEqual(await createUaeSubmitter({ queue: s.uaeQueue, fetchImpl }).run(), { sent: 1, rejected: 1 });
  assert.equal(calls[0].init.headers['X-Api-Key'], 'k-123');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/xml');
  const st = Object.fromEntries(db.prepare('SELECT id, status, error FROM uae_documents').all().map((r) => [r.id, r]));
  assert.equal(st[d1.id].status, 'sent');
  assert.equal(st[d2.id].status, 'rejected');
  assert.match(st[d2.id].error, /422 buyer endpoint unknown/);
  s.uae.retry(d2.id);
  await createUaeSubmitter({ queue: s.uaeQueue, fetchImpl: async () => { throw new Error('offline'); } }).run();
  assert.equal(db.prepare('SELECT status FROM uae_documents WHERE id = ?').get(d2.id).status, 'pending');
  s.uae.markExported([d2.id]);
  assert.equal(db.prepare('SELECT status FROM uae_documents WHERE id = ?').get(d2.id).status, 'exported');
});
