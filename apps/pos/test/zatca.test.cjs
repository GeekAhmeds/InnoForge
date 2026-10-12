'use strict';
// Saudi e-invoicing (ZATCA): curve math against OpenSSL, the CSR, the certificate, the XML and
// its hash (a golden value checked with ZATCA's own validator, SDK 238-R3.4.8), the stamp and
// QR, the chain kept by the services, and the submitter against a fake ZATCA (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('../electron/db.cjs');
const { createServices } = require('../electron/services/index.cjs');
const { entitlements } = require('../electron/editions.cjs');
const Z = require('../electron/zatca.cjs');
const { createZatcaSubmitter } = require('../electron/zatca-submitter.cjs');

// ZATCA's public test certificate (from its e-invoicing SDK).
const TEST_CERT = 'MIID3jCCA4SgAwIBAgITEQAAOAPF90Ajs/xcXwABAAA4AzAKBggqhkjOPQQDAjBiMRUwEwYKCZImiZPyLGQBGRYFbG9jYWwxEzARBgoJkiaJk/IsZAEZFgNnb3YxFzAVBgoJkiaJk/IsZAEZFgdleHRnYXp0MRswGQYDVQQDExJQUlpFSU5WT0lDRVNDQTQtQ0EwHhcNMjQwMTExMDkxOTMwWhcNMjkwMTA5MDkxOTMwWjB1MQswCQYDVQQGEwJTQTEmMCQGA1UEChMdTWF4aW11bSBTcGVlZCBUZWNoIFN1cHBseSBMVEQxFjAUBgNVBAsTDVJpeWFkaCBCcmFuY2gxJjAkBgNVBAMTHVRTVC04ODY0MzExNDUtMzk5OTk5OTk5OTAwMDAzMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7tPydo8mq0ahOMmNo8gwni7Xt1KT9UeKOCAgcwggIDMIGtBgNVHREEgaUwgaKkgZ8wgZwxOzA5BgNVBAQMMjEtVFNUfDItVFNUfDMtZWQyMmYxZDgtZTZhMi0xMTE4LTliNTgtZDlhOGYxMWU0NDVmMR8wHQYKCZImiZPyLGQBAQwPMzk5OTk5OTk5OTAwMDAzMQ0wCwYDVQQMDAQxMTAwMREwDwYDVQQaDAhSUlJEMjkyOTEaMBgGA1UEDwwRU3VwcGx5IGFjdGl2aXRpZXMwHQYDVR0OBBYEFEX+YvmmtnYoDf9BGbKo7ocTKYK1MB8GA1UdIwQYMBaAFJvKqqLtmqwskIFzVvpP2PxT+9NnMHsGCCsGAQUFBwEBBG8wbTBrBggrBgEFBQcwAoZfaHR0cDovL2FpYTQuemF0Y2EuZ292LnNhL0NlcnRFbnJvbGwvUFJaRUludm9pY2VTQ0E0LmV4dGdhenQuZ292LmxvY2FsX1BSWkVJTlZPSUNFU0NBNC1DQSgxKS5jcnQwDgYDVR0PAQH/BAQDAgeAMDwGCSsGAQQBgjcVBwQvMC0GJSsGAQQBgjcVCIGGqB2E0PsShu2dJIfO+xnTwFVmh/qlZYXZhD4CAWQCARIwHQYDVR0lBBYwFAYIKwYBBQUHAwMGCCsGAQUFBwMCMCcGCSsGAQQBgjcVCgQaMBgwCgYIKwYBBQUHAwMwCgYIKwYBBQUHAwIwCgYIKoZIzj0EAwIDSAAwRQIhALE/ichmnWXCUKUbca3yci8oqwaLvFdHVjQrveI9uqAbAiA9hC4M8jgMBADPSzmd2uiPJA6gKR3LE03U75eqbC/rXA==';

const tryCode = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const opensslKey = (hex) => crypto.createPrivateKey(Z.privateKeyPem(hex));

test('zatca: secp256k1 signatures agree with OpenSSL both ways', () => {
  const k = Z.generateKey();
  const key = opensslKey(k.privateKey);
  const pub = crypto.createPublicKey(key);
  assert.equal(pub.export({ type: 'spki', format: 'der' }).toString('base64'), k.publicKey);
  for (let i = 0; i < 25; i++) {
    const msg = crypto.randomBytes(1 + i * 3);
    assert.ok(crypto.verify('sha256', msg, pub, Z.ecdsaSign(msg, k.privateKey)), 'OpenSSL accepts ours');
    assert.ok(Z.ecdsaVerify(msg, crypto.sign('sha256', msg, key), Z.pointOf(k.privateKey)), 'we accept OpenSSL');
  }
  assert.equal(Z.ecdsaVerify(Buffer.from('a'), Z.ecdsaSign(Buffer.from('b'), k.privateKey), Z.pointOf(k.privateKey)), false);
});

test('zatca: the certificate request is valid and carries the device details', () => {
  const k = Z.generateKey();
  const b64 = Z.buildCsr({ vat: '399999999900003', commonName: 'POS-1', orgName: 'شركة النور', orgUnit: 'Riyadh', serial: '1-InnoForge|2-POS|3-abc', invoiceTypes: '1100', address: '1234 King Fahd', industry: 'Retail' }, k.privateKey, 'simulation');
  const pem = Buffer.from(b64, 'base64').toString();
  assert.match(pem, /^-----BEGIN CERTIFICATE REQUEST-----/);
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  // The request is signed with the device key: verify that signature with OpenSSL.
  const total = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const criLen = der[total + 1] & 0x80 ? (der[total + 2] << 8) + der[total + 3] + 4 : der[total + 1] + 2;
  const cri = der.subarray(total, total + criLen);
  const rest = der.subarray(total + criLen);
  const sigBits = rest.subarray(rest[1] + 2); // skip the algorithm
  const sig = sigBits.subarray(3);
  assert.ok(crypto.verify('sha256', cri, crypto.createPublicKey(opensslKey(k.privateKey)), sig));
  const text = der.toString('latin1');
  for (const part of ['PREZATCA-Code-Signing', '1-InnoForge|2-POS|3-abc', '399999999900003', '1100']) assert.ok(text.includes(part), part);
});

test('zatca: certificate details match the official SDK output', () => {
  const c = Z.parseCert(Buffer.from(TEST_CERT).toString('base64')); // as ZATCA sends it (binarySecurityToken)
  assert.equal(c.issuer, 'CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local');
  assert.equal(c.serial, '379112742831380471835263969587287663520528387');
  assert.equal(c.digest, 'ZDMwMmI0MTE1NzVjOTU2NTk4YzVlODhhYmI0ODU2NDUyNTU2YTVhYjhhMDFmN2FjYjk1YTA2OWQ0NjY2MjQ4NQ==');
  assert.equal(c.validTo.toISOString().slice(0, 10), '2029-01-09');
  assert.equal(Z.parseCert(`-----BEGIN CERTIFICATE-----\n${TEST_CERT}\n-----END CERTIFICATE-----`).serial, c.serial);
});

const SELLER = { decimals: 2, tax_rate: 15, tax_number: '399999999900003', zatca_name: 'سوبر ماركت النور', zatca_crn: '1010010000', zatca_street: 'شارع التحلية', zatca_building: '1234', zatca_plot: '5678', zatca_district: 'العليا', zatca_city: 'الرياض', zatca_postal: '12345' };

test('zatca: invoice XML and hash (golden value from ZATCA\'s validator)', () => {
  const input = {
    doc: { kind: 'invoice', standard: false, id: '1001', uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be', icv: 7, pih: Z.INITIAL_PIH, issued: '2026-10-12 14:05:09', payment: 'cash' },
    order: { total: 4789, tax: 625, service: 300, delivery_fee: 0 },
    items: [{ name: 'تفاح', qty: 0.735, line_total: 1102 }, { name: 'عصير & ماء <1L>', qty: 3, line_total: 3387 }],
    customer: null, settings: SELLER,
  };
  const built = Z.buildXml(input);
  assert.equal(Z.invoiceHash(built.xml), 'Rp/duHnxoFaCutKkZbXt8LifCuBNc7/VCtaww2YxkdA=');
  assert.deepEqual(built.totals, { taxable: 4164, vat: 625, total: 4789, rounding: 0 });
  assert.match(built.xml, /<cbc:InvoiceTypeCode name="0200000">388<\/cbc:InvoiceTypeCode>/);
  assert.match(built.xml, /<cbc:ID schemeAgencyID="6" schemeID="UN\/ECE 5305">S<\/cbc:ID>/); // canonical attribute order
  assert.match(built.xml, /عصير &amp; ماء &lt;1L&gt;/);
  assert.doesNotMatch(built.xml, /\/>/); // never self-closing (canonical form)

  // Stamped: signature over the hash, 9-field QR with the hash and the certificate's key.
  const k = Z.generateKey();
  const r = Z.stamp(input, { privateKey: k.privateKey, certificate: Buffer.from(TEST_CERT).toString('base64') });
  assert.equal(r.hash, 'Rp/duHnxoFaCutKkZbXt8LifCuBNc7/VCtaww2YxkdA=');
  assert.ok(crypto.verify('sha256', Buffer.from(r.hash, 'base64'), crypto.createPublicKey(opensslKey(k.privateKey)), Buffer.from(r.signature, 'base64')));
  assert.equal(Z.invoiceHash(r.xml.replace(/^<\?xml[^>]*>\n/, '').replace(/<ext:UBLExtensions>[\s\S]*<\/ext:UBLExtensions>/, '<!--EXT-->')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, '').replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')), r.hash);
  const qr = Buffer.from(r.qr, 'base64');
  const fields = [];
  for (let i = 0; i < qr.length;) {
    let len = qr[i + 1]; let off = 2;
    if (len === 0x81) { len = qr[i + 2]; off = 3; }
    fields.push(qr.subarray(i + off, i + off + len)); i += off + len;
  }
  assert.equal(fields.length, 9);
  assert.deepEqual(fields.slice(0, 6).map(String), ['سوبر ماركت النور', '399999999900003', '2026-10-12T14:05:09', '47.89', '6.25', r.hash]);
  assert.equal(String(fields[6]), r.signature);
  assert.deepEqual(fields[7], Z.parseCert(TEST_CERT).publicKey);
});

test('zatca: amounts — VAT = taxable × 15% and taxable + VAT = what was paid (or a 1-halala rounding)', () => {
  for (let total = 1; total < 4000; total += 7) {
    const lines = [{ amount: Math.floor(total / 3) }, { amount: total - Math.floor(total / 3) }];
    const a = Z.amounts({ total, rate: 15, lines });
    assert.equal(a.T, Math.round(a.X * 0.15 + 1e-9));
    assert.equal(a.X + a.T + a.rounding, total);
    assert.ok(Math.abs(a.rounding) <= 1);
    assert.equal(a.nets.reduce((s, l) => s + l.net, 0), a.X);
  }
});

// ---------------------------------------------------------------- services + submitter
function saudiShop() {
  const db = openDatabase(':memory:');
  const s = createServices(db, { entitlements: () => entitlements({ edition: 'trading', country: 'SA' }) });
  s.auth.setup({ business: { business_name: 'متجر', business_type: 'trading', country: 'SA', currency: 'SAR', tax_rate: 15, prices_include_tax: true, tax_number: '399999999900003' }, admin: { name: 'A', username: 'admin', pin: '1234' } });
  s.auth.login({ username: 'admin', pin: '1234' });
  const { tax_rate: _r, decimals: _d, tax_number: _t, ...seller } = SELLER;
  s.settings.save({ ...seller, zatca_env: 'simulation' });
  s.shifts.open({});
  const pen = s.products.save({ name: 'قلم', price: 1150, cost: 500, stock: 100 });
  return { db, s, pen };
}

function fakeZatca(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace(/^https:\/\/[^/]+\/e-invoicing\/[a-z-]+/, '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, headers: init.headers, body });
    const [status, data] = handler(path, body, init.headers);
    return { status, json: async () => data };
  };
  return { calls, fetchImpl };
}

test('zatca: onboarding (CSR → compliance checks → production certificate), then every sale is stamped and chained', async () => {
  const { s, db, pen } = saudiShop();
  assert.equal(tryCode(() => s.settings.save({ zatca_enabled: true })), 'ZATCA_NOT_ONBOARDED');
  const token = Buffer.from(TEST_CERT).toString('base64');
  const { calls, fetchImpl } = fakeZatca((path) => {
    if (path === '/compliance') return [200, { requestID: 1234, binarySecurityToken: token, secret: 'c-secret' }];
    if (path === '/compliance/invoices') return [200, { validationResults: { status: 'PASS' } }];
    if (path === '/production/csids') return [200, { binarySecurityToken: token, secret: 'p-secret' }];
    return [404, {}];
  });
  const sub = createZatcaSubmitter({ queue: s.zatcaQueue, fetchImpl });
  await assert.rejects(sub.onboard({ otp: 'x' }), { code: 'ZATCA_OTP' });
  const res = await sub.onboard({ otp: '123456' });
  assert.equal(res.checks.length, 6); // invoice, credit, debit × (B2B, B2C)
  assert.equal(calls[0].headers.OTP, '123456');
  assert.match(Buffer.from(calls[0].body.csr, 'base64').toString(), /BEGIN CERTIFICATE REQUEST/);
  assert.equal(calls[1].headers.Authorization, `Basic ${Buffer.from(`${token}:c-secret`).toString('base64')}`);
  assert.deepEqual(calls.at(-1).body, { compliance_request_id: '1234' });
  const st = s.settings.get();
  assert.equal(st.zatca_key, ''); // secret, never shown
  assert.equal(st.zatca_key_set, true);
  assert.equal(st.zatca_onboarded_env, 'simulation');
  assert.equal(st.zatca_cert_expires, '2029-01-09');
  // A form can never overwrite the device key.
  s.settings.save({ zatca_key: 'ff', zatca_enabled: true });
  assert.notEqual(s.zatcaQueue.settings().zatca_key, 'ff');

  const o1 = s.orders.checkout({ items: [{ product_id: pen, qty: 2 }], payments: [{ method: 'cash', amount: 2300 }] });
  const o2 = s.orders.checkout({ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'card', amount: 1150 }] });
  const docs = db.prepare('SELECT * FROM zatca_documents ORDER BY icv').all();
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.icv), [1, 2]);
  assert.ok(docs[0].xml.includes(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${Z.INITIAL_PIH}`));
  assert.ok(docs[1].xml.includes(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${docs[0].hash}`)); // the chain
  assert.equal(o1.zatca_qr, docs[0].qr);
  assert.ok(docs[1].xml.includes('<cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>'));
  // A return becomes a credit note pointing at the invoice.
  s.orders.refund({ orderId: o2.id, items: [{ order_item_id: o2.items[0].id, qty: 1 }], reason: 'تالف' });
  const credit = db.prepare("SELECT * FROM zatca_documents WHERE kind = 'credit'").get();
  assert.equal(credit.icv, 3);
  assert.match(credit.xml, /<cbc:InvoiceTypeCode name="0200000">381<\/cbc:InvoiceTypeCode>/);
  assert.match(credit.xml, new RegExp(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${o2.invoice_no}</cbc:ID>`));
  assert.match(credit.xml, /<cbc:InstructionNote>تالف<\/cbc:InstructionNote>/);
  assert.equal(s.zatca.summary().counts.pending, 3);
});

test('zatca: reporting, clearance (ZATCA\'s copy replaces ours), rejections and re-issuing', async () => {
  const { s, db, pen } = saudiShop();
  const k = Z.generateKey();
  s.zatcaQueue.saveCredentials({ zatca_key: k.privateKey, zatca_cert: Buffer.from(TEST_CERT).toString('base64'), zatca_secret: 'p', zatca_onboarded_env: 'simulation' });
  s.settings.save({ zatca_enabled: true });
  const cust = s.customers.save({ name: 'شركة الأمل', tax_number: '399999999800003', zatca: JSON.stringify({ street: 'King Fahd', building: '1111', district: 'Olaya', city: 'Riyadh', postal: '12345' }) });
  s.orders.checkout({ items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 1150 }] });
  s.orders.checkout({ customer_id: cust, items: [{ product_id: pen, qty: 1 }], payments: [{ method: 'cash', amount: 1150 }] });
  s.orders.checkout({ items: [{ product_id: pen, qty: 3 }], payments: [{ method: 'cash', amount: 3450 }] });
  const [simple, b2b, bad] = db.prepare('SELECT * FROM zatca_documents ORDER BY icv').all();
  assert.equal(simple.standard, 0);
  assert.equal(b2b.standard, 1);
  assert.match(b2b.xml, /name="0100000"/);
  const cleared = b2b.xml.replace(/(<cbc:ID>QR<\/cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)[^<]+/, '$1ZATCA-QR');
  const { calls, fetchImpl } = fakeZatca((path, body) => {
    if (path === '/invoices/clearance/single') return [200, { clearanceStatus: 'CLEARED', clearedInvoice: Buffer.from(cleared).toString('base64') }];
    if (body.uuid === bad.uuid) return [400, { validationResults: { status: 'ERROR', errorMessages: [{ code: 'BR-KSA-37', message: 'building number' }] } }];
    return [200, { reportingStatus: 'REPORTED', validationResults: { status: 'PASS' } }];
  });
  const sub = createZatcaSubmitter({ queue: s.zatcaQueue, fetchImpl });
  assert.deepEqual(await sub.run(), { sent: 2, rejected: 1 });
  assert.equal(calls[0].path, '/invoices/reporting/single');
  assert.equal(calls[0].headers['Clearance-Status'], '0');
  assert.equal(calls[1].path, '/invoices/clearance/single');
  assert.equal(calls[1].headers['Clearance-Status'], '1');
  assert.equal(Buffer.from(calls[0].body.invoice, 'base64').toString(), simple.xml);
  const after = Object.fromEntries(db.prepare('SELECT icv, status, qr FROM zatca_documents').all().map((r) => [r.icv, r]));
  assert.equal(after[1].status, 'reported');
  assert.equal(after[2].status, 'cleared');
  assert.equal(after[2].qr, 'ZATCA-QR');
  assert.equal(db.prepare('SELECT zatca_qr FROM orders WHERE id = ?').get(b2b.order_id).zatca_qr, 'ZATCA-QR'); // printed from now on
  assert.equal(after[3].status, 'rejected');
  assert.match(s.zatca.get(bad.id).error, /BR-KSA-37/);
  // Fixed and issued again: a new number at the end of the chain.
  s.zatca.restamp(bad.id);
  const again = db.prepare('SELECT * FROM zatca_documents ORDER BY icv DESC LIMIT 1').get();
  assert.equal(again.icv, 4);
  assert.equal(again.order_id, bad.order_id);
  assert.equal(db.prepare('SELECT status FROM zatca_documents WHERE id = ?').get(bad.id).status, 'skipped');
  // ZATCA unreachable: nothing changes, the round just stops.
  const down = createZatcaSubmitter({ queue: s.zatcaQueue, fetchImpl: async () => { throw new Error('offline'); } });
  await down.run();
  assert.equal(db.prepare('SELECT status FROM zatca_documents WHERE id = ?').get(again.id).status, 'pending');
});

test('zatca: preview needs the seller details; switched off outside Saudi Arabia', () => {
  const { s } = saudiShop();
  s.orders.checkout({ items: [{ product_id: s.products.list ? 1 : 1, qty: 1 }], payments: [{ method: 'cash', amount: 1150 }] });
  const p = s.zatca.preview({});
  assert.match(p.xml, /^<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/);
  s.settings.save({ zatca_postal: '12' });
  assert.equal(tryCode(() => s.zatca.preview({})), 'ZATCA_MISSING');
  assert.equal(tryCode(() => s.settings.save({ country: 'EG' })), 'LICENSE_COUNTRY');
});
