'use strict';
// Saudi e-invoicing (ZATCA / FATOORA): registers this device and sends the stamped documents.
// Runs in the main process of the computer that holds the data (never on a connected client).
//
//   onboarding: new device key → CSR → POST /compliance (with the OTP from the FATOORA portal)
//               → compliance checks of sample documents (invoice, credit and debit note for
//               each declared type) → POST /production/csids → production certificate
//   reporting:  simplified invoices / notes → POST /invoices/reporting/single (within 24 hours)
//   clearance:  standard (B2B) invoices / notes → POST /invoices/clearance/single; ZATCA
//               returns its stamped copy (with its own QR), which replaces ours
//
// Written from ZATCA's published API documentation; documents are checked offline with
// ZATCA's own validator. Run each new taxpayer through the simulation portal first.
const Z = require('./zatca.cjs');

const errorText = (data) => {
  const v = data?.validationResults || {};
  const msgs = [...(v.errorMessages || []), ...(data?.errors || [])].map((m) => (typeof m === 'string' ? m : `${m.code || ''} ${m.message || ''}`.trim()));
  return msgs.filter(Boolean).join(' | ') || data?.message || data?.dispositionMessage || '';
};
const warningText = (data) => (data?.validationResults?.warningMessages || []).map((m) => `${m.code || ''} ${m.message || ''}`.trim()).join(' | ');
const basic = (token, secret) => `Basic ${Buffer.from(`${token}:${secret}`).toString('base64')}`;

function createZatcaSubmitter({ queue, fetchImpl = (...a) => fetch(...a), log = () => {}, version = '' }) {
  let running = null;
  let timer = null;
  let last = { at: null, ok: true, message: '' };

  async function call(s, path, { body, auth, headers = {}, method = 'POST' }) {
    const res = await fetchImpl(`${Z.ENDPOINTS[s.zatca_env] || Z.ENDPOINTS.simulation}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Version': 'V2', 'Accept-Language': 'en', ...(auth ? { Authorization: auth } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // A small sale used for the compliance checks (100 SAR + 15% VAT).
  const sample = (s) => ({
    order: { total: 11500, tax: 1500, service: 0, delivery_fee: 0, completed_at: null },
    items: [{ name: 'Compliance sample', qty: 1, line_total: 11500 }],
    customer: { name: 'Compliance Buyer', tax_number: '399999999800003', zatca: { street: 'King Fahd Road', building: '1234', district: 'Olaya', city: 'Riyadh', postal: '12345' } },
    settings: { ...s, decimals: 2, tax_rate: 15 },
  });

  /** Registers this computer with ZATCA. `otp` comes from the FATOORA portal (any value on the developer portal). */
  async function onboard({ otp }) {
    const s = queue.settings();
    const missing = Z.missingSettings(s);
    if (missing.length) throw Object.assign(new Error(missing.join(',')), { code: 'ZATCA_MISSING' });
    if (!/^\d{4,8}$/.test(String(otp || '').trim())) throw Object.assign(new Error('otp'), { code: 'ZATCA_OTP' });
    const key = Z.generateKey();
    const serial = `1-InnoForge|2-POS${version ? `-${version}` : ''}|3-${Z.uuid()}`;
    const types = s.zatca_b2b ? '1100' : '0100';
    const vat = String(s.tax_number);
    const csr = Z.buildCsr({
      vat,
      commonName: `${s.zatca_branch || 'POS'}-${vat}`.slice(0, 64),
      orgName: s.zatca_name || s.business_name,
      // A VAT group member (11th digit 1) must put its 10-digit TIN here.
      orgUnit: vat[10] === '1' ? vat.slice(0, 10) : (s.zatca_branch || s.zatca_city),
      serial,
      invoiceTypes: types,
      address: `${s.zatca_building} ${s.zatca_street}, ${s.zatca_district}, ${s.zatca_city}`,
      industry: s.zatca_industry || 'Retail',
    }, key.privateKey, s.zatca_env);

    const comp = await call(s, '/compliance', { body: { csr }, headers: { OTP: String(otp).trim() } });
    if (comp.status !== 200 || !comp.data.binarySecurityToken) {
      throw Object.assign(new Error(errorText(comp.data) || `HTTP ${comp.status}`), { code: comp.status === 400 ? 'ZATCA_OTP_REJECTED' : 'ZATCA_ONBOARD' });
    }
    const cAuth = basic(comp.data.binarySecurityToken, comp.data.secret);

    // Compliance checks: the document kinds this device declared.
    const kinds = [];
    for (const standard of types[0] === '1' ? [true, false] : [false]) for (const kind of ['invoice', 'credit', 'debit']) kinds.push({ standard, kind });
    let pih = Z.INITIAL_PIH;
    const checks = [];
    for (const [i, k] of kinds.entries()) {
      const input = sample(s);
      const now = new Date(Date.now() - 60000);
      const pad = (n) => String(n).padStart(2, '0');
      input.order.completed_at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const doc = { kind: k.kind, standard: k.standard, id: `CMP-${i + 1}`, uuid: Z.uuid(), icv: i + 1, pih, issued: input.order.completed_at, original: 'CMP-1', reason: 'Compliance check', payment: 'cash' };
      const r = Z.stamp({ doc, ...input }, { privateKey: key.privateKey, certificate: comp.data.binarySecurityToken });
      pih = r.hash;
      const res = await call(s, '/compliance/invoices', { auth: cAuth, body: { invoiceHash: r.hash, uuid: doc.uuid, invoice: Buffer.from(r.xml).toString('base64') } });
      const status = res.data?.validationResults?.status || `HTTP ${res.status}`;
      checks.push({ kind: k.kind, standard: k.standard, status, errors: errorText(res.data), warnings: warningText(res.data) });
      if (res.status >= 400 && res.status !== 400) throw Object.assign(new Error(errorText(res.data) || `HTTP ${res.status}`), { code: 'ZATCA_ONBOARD', checks });
    }
    const failed = checks.filter((c) => c.status === 'ERROR' || /^HTTP/.test(c.status));
    // The developer portal hands out a fixed test certificate that does not match our key, so its
    // signature checks fail there by design; only simulation and production must pass.
    if (failed.length && s.zatca_env !== 'sandbox') throw Object.assign(new Error(failed.map((c) => `${c.standard ? 'B2B' : 'B2C'} ${c.kind}: ${c.errors}`).join(' || ')), { code: 'ZATCA_COMPLIANCE', checks });

    const prod = await call(s, '/production/csids', { auth: cAuth, body: { compliance_request_id: String(comp.data.requestID) } });
    if (prod.status !== 200 || !prod.data.binarySecurityToken) throw Object.assign(new Error(errorText(prod.data) || `HTTP ${prod.status}`), { code: 'ZATCA_ONBOARD', checks });
    let expires = '';
    try { expires = Z.parseCert(prod.data.binarySecurityToken).validTo.toISOString().slice(0, 10); } catch { /* the developer portal's canned certificate */ }
    queue.saveCredentials({
      zatca_key: key.privateKey, zatca_serial: serial, zatca_cert: prod.data.binarySecurityToken, zatca_secret: prod.data.secret,
      zatca_onboarded_env: s.zatca_env, zatca_cert_expires: expires,
    });
    return { ok: true, env: s.zatca_env, expires, checks };
  }

  /** Sends one document; returns the status it ended in (or throws to stop the round). */
  async function send(s, d) {
    const auth = basic(s.zatca_cert, s.zatca_secret);
    const body = { invoiceHash: d.hash, uuid: d.uuid, invoice: Buffer.from(d.xml).toString('base64') };
    let res = d.standard
      ? await call(s, '/invoices/clearance/single', { auth, body, headers: { 'Clearance-Status': '1' } })
      : await call(s, '/invoices/reporting/single', { auth, body, headers: { 'Clearance-Status': '0' } });
    // Clearance switched off by ZATCA: standard invoices are reported instead.
    if (d.standard && res.status === 303) res = await call(s, '/invoices/reporting/single', { auth, body, headers: { 'Clearance-Status': '0' } });
    if (res.status === 401) throw Object.assign(new Error('ZATCA login refused — register the device again'), { code: 'ZATCA_AUTH' });
    if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`ZATCA HTTP ${res.status}`), { code: 'ZATCA_OFFLINE' });
    if (res.status === 200 || res.status === 202) {
      const cleared = res.data?.clearedInvoice ? Buffer.from(res.data.clearedInvoice, 'base64').toString('utf8') : null;
      const qr = cleared ? (/<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</.exec(cleared) || [])[1] || null : null;
      const status = res.status === 202 ? 'warning' : cleared ? 'cleared' : 'reported';
      queue.result(d.id, { status, error: warningText(res.data), response: res.data, xml: cleared, qr });
      return status;
    }
    if (res.status === 409) { // already received (sent twice)
      queue.result(d.id, { status: 'reported', error: errorText(res.data), response: res.data });
      return 'reported';
    }
    queue.result(d.id, { status: 'rejected', error: errorText(res.data) || `HTTP ${res.status}`, response: res.data });
    return 'rejected';
  }

  /** One round: everything waiting, oldest first. Stops at the first connection problem. */
  async function run() {
    if (running) return running;
    running = (async () => {
      const out = { sent: 0, rejected: 0 };
      try {
        const s = queue.settings();
        if (!s.zatca_enabled || !s.zatca_cert) return out;
        for (const d of queue.toSend(200)) {
          const status = await send(s, d);
          if (status === 'rejected') out.rejected++; else out.sent++;
        }
        last = { at: new Date().toISOString(), ok: true, message: '' };
      } catch (err) {
        last = { at: new Date().toISOString(), ok: false, message: err.message, code: err.code };
        if (err.code !== 'ZATCA_OFFLINE') log('ZATCA', err);
      } finally {
        running = null;
      }
      return out;
    })();
    return running;
  }

  return {
    onboard,
    run,
    state: () => last,
    start(everyMs = 5 * 60000) {
      clearInterval(timer);
      timer = setInterval(() => { try { if (queue.settings().zatca_auto) run(); } catch { /* not ready */ } }, everyMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); },
  };
}

module.exports = { createZatcaSubmitter };
