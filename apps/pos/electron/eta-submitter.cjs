'use strict';
// Sends the queued e-invoices / e-receipts to the Egyptian Tax Authority and follows their
// validation. Runs in the main process of the computer that holds the data (never on a
// connected client), every few minutes when "send automatically" is on, or on demand.
//
//   e-invoice: token (ERP client id/secret) → sign each document with the company's USB
//              token through the configured signer → POST /api/v1/documentsubmissions
//   e-receipt: token (POS client id/secret + POS serial + pre-shared key, per computer)
//              → POST /api/v1/receiptsubmissions (receipts carry their own UUID chain)
//   then:      GET the details of submitted documents until ETA says Valid / Invalid.
//
// Written against ETA's published API documentation; not yet exercised on the live system.
const { spawn } = require('node:child_process');
const { ENDPOINTS, serialize } = require('./eta.cjs');

const errorText = (e) => {
  if (!e) return '';
  if (typeof e === 'string') return e;
  const details = (e.details || e.error?.details || []).map((d) => d.message || d.code).filter(Boolean);
  return [e.message || e.error?.message || e.code || e.error?.code, ...details].filter(Boolean).join(' — ') || JSON.stringify(e).slice(0, 500);
};

/** The company's USB token signs the serialized document (CAdES-BES, base64). */
async function signWith(s, serialized, fetchImpl) {
  if (s.eta_signer === 'url' && s.eta_signer_url) {
    const res = await fetchImpl(s.eta_signer_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serialized }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`signer HTTP ${res.status}`);
    const data = await res.json();
    if (!data.signature) throw new Error('signer returned no signature');
    return String(data.signature);
  }
  if (s.eta_signer === 'command' && s.eta_signer_cmd) {
    return new Promise((resolve, reject) => {
      const child = spawn(s.eta_signer_cmd, { shell: true, windowsHide: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('signer timed out')); }, 60000);
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) resolve(out.trim());
        else reject(new Error(`signer exit ${code}: ${err.trim().slice(0, 300)}`));
      });
      child.stdin.end(serialized, 'utf8');
    });
  }
  throw Object.assign(new Error('no signer configured'), { code: 'ETA_NO_SIGNER' });
}

function createEtaSubmitter({ queue, fetchImpl = (...a) => fetch(...a), sign = signWith, log = () => {} }) {
  const tokens = new Map(); // client id → { token, until }
  let running = null;
  let timer = null;
  let last = { at: null, ok: true, message: '' };

  async function token(s, pos) {
    const clientId = pos ? s.eta_pos_client_id : s.eta_client_id;
    const secret = pos ? s.eta_pos_client_secret : s.eta_client_secret;
    const cacheKey = `${s.eta_env}:${clientId}:${pos ? s.eta_pos_serial : ''}`;
    const hit = tokens.get(cacheKey);
    if (hit && hit.until > Date.now() + 60000) return hit.token;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (pos) Object.assign(headers, { posserial: s.eta_pos_serial, pososversion: s.eta_pos_os || 'Windows', posmodelframework: s.eta_pos_model || '1', presharedkey: s.eta_pos_key || '' });
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret, scope: 'InvoicingAPI' });
    const res = await fetchImpl(`${(ENDPOINTS[s.eta_env] || ENDPOINTS.preprod).id}/connect/token`, { method: 'POST', headers, body: body.toString(), signal: AbortSignal.timeout(30000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw Object.assign(new Error(`ETA login: ${data.error_description || data.error || `HTTP ${res.status}`}`), { code: 'ETA_AUTH' });
    tokens.set(cacheKey, { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
    return data.access_token;
  }

  async function api(s, accessToken, method, pathName, body) {
    const res = await fetchImpl(`${(ENDPOINTS[s.eta_env] || ENDPOINTS.preprod).api}${pathName}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept-Language': 'ar' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async function sendInvoices() {
    const docs = queue.ready('invoice', 20);
    if (!docs.length) return 0;
    const s = queue.settings('local');
    const out = [];
    for (const d of docs) {
      const doc = { ...d.payload };
      delete doc.signatures;
      try {
        doc.signatures = [{ signatureType: 'I', value: await sign(s, serialize(doc), fetchImpl) }];
        queue.setPayload(d.id, doc);
        out.push({ row: d, doc });
      } catch (err) {
        queue.result(d.id, { status: 'error', error: `${err.code || 'ETA_SIGN'}: ${err.message}` });
      }
    }
    if (!out.length) return 0;
    const res = await api(s, await token(s, false), 'POST', '/api/v1/documentsubmissions', { documents: out.map((x) => x.doc) });
    applySubmission(res, out.map((x) => ({ id: x.row.id, key: x.doc.internalID })), 'internalId');
    return out.length;
  }

  async function sendReceipts() {
    const docs = queue.ready('receipt', 100);
    if (!docs.length) return 0;
    const byDevice = new Map();
    for (const d of docs) byDevice.set(d.device_id, [...(byDevice.get(d.device_id) || []), d]);
    for (const [deviceId, list] of byDevice) {
      const s = queue.settings(deviceId);
      const res = await api(s, await token(s, true), 'POST', '/api/v1/receiptsubmissions', { receipts: list.map((d) => d.payload) });
      applySubmission(res, list.map((d) => ({ id: d.id, key: d.payload.header.uuid })), 'uuid');
    }
    return docs.length;
  }

  /** Accepted → submitted (waiting for validation), rejected → rejected with ETA's reasons. */
  function applySubmission(res, rows, keyField) {
    if (!res.ok && !res.data?.acceptedDocuments && !res.data?.rejectedDocuments) {
      const message = `HTTP ${res.status} ${errorText(res.data?.error || res.data)}`;
      // 401/5xx: try again later; anything else is a problem with the documents.
      const status = res.status === 401 || res.status >= 500 || res.status === 429 ? 'pending' : 'rejected';
      for (const r of rows) queue.result(r.id, { status, error: message });
      if (status === 'pending') throw new Error(message);
      return;
    }
    const accepted = res.data.acceptedDocuments || [];
    const rejected = res.data.rejectedDocuments || [];
    for (const r of rows) {
      const a = accepted.find((x) => String(x[keyField] ?? x.internalId ?? x.uuid) === String(r.key));
      const j = rejected.find((x) => String(x[keyField] ?? x.internalId ?? x.uuid) === String(r.key));
      if (a) queue.result(r.id, { status: 'submitted', uuid: a.uuid, long_id: a.longId, submission_id: res.data.submissionId });
      else if (j) queue.result(r.id, { status: 'rejected', error: errorText(j.error), submission_id: res.data.submissionId });
      else queue.result(r.id, { status: 'submitted', submission_id: res.data.submissionId });
    }
  }

  async function poll() {
    const rows = queue.toPoll(50);
    const receiptSubs = new Map();
    for (const r of rows) {
      const s = queue.settings(r.device_id);
      if (r.kind === 'invoice') {
        if (!r.uuid) continue;
        const res = await api(s, await token(s, false), 'GET', `/api/v1/documents/${r.uuid}/details`);
        if (!res.ok) continue;
        const st = String(res.data.status || '').toLowerCase();
        const steps = res.data.validationResults?.validationSteps || [];
        const why = steps.filter((x) => String(x.status).toLowerCase() === 'invalid').map((x) => `${x.name || ''} ${errorText(x.error)}`.trim()).join('; ');
        if (st === 'valid') queue.result(r.id, { status: 'valid' });
        else if (st === 'invalid') queue.result(r.id, { status: 'invalid', error: why || 'Invalid' });
        else if (st === 'cancelled' || st === 'rejected') queue.result(r.id, { status: 'cancelled', error: st });
      } else if (r.submission_id) {
        receiptSubs.set(r.submission_id, [...(receiptSubs.get(r.submission_id) || []), r]);
      }
    }
    for (const [sub, list] of receiptSubs) {
      const s = queue.settings(list[0].device_id);
      const res = await api(s, await token(s, true), 'GET', `/api/v1/receiptsubmissions/${sub}/details?PageNo=1&PageSize=100`);
      if (!res.ok) continue;
      const items = res.data.receipts || [];
      for (const r of list) {
        const it = items.find((x) => x.uuid === r.uuid);
        const st = String(it?.status || (items.length ? '' : res.data.status) || '').toLowerCase();
        if (st === 'valid') queue.result(r.id, { status: 'valid' });
        else if (st === 'invalid') queue.result(r.id, { status: 'invalid', error: errorText(it?.errors?.[0] || it?.error) || 'Invalid' });
      }
    }
  }

  /** One round: build, send, follow up. Returns a short report. */
  function run() {
    if (running) return running;
    running = (async () => {
      const s = queue.settings('local');
      if (!s.eta_enabled) return { skipped: true };
      queue.prepare();
      const sent = { invoices: 0, receipts: 0 };
      try {
        if (s.eta_invoice) sent.invoices = await sendInvoices();
        if (s.eta_receipt) sent.receipts = await sendReceipts();
        await poll();
        last = { at: new Date().toISOString(), ok: true, message: '' };
      } catch (err) {
        last = { at: new Date().toISOString(), ok: false, message: err.message || String(err) };
        log('e-invoice', err);
      }
      return { ...sent, last };
    })().finally(() => { running = null; });
    return running;
  }

  /** Can we log in with the saved credentials? */
  async function test(deviceId = 'local') {
    const s = queue.settings(deviceId);
    const out = {};
    for (const [kind, pos, on] of [['invoice', false, s.eta_invoice], ['receipt', true, s.eta_receipt]]) {
      if (!on) continue;
      try { await token(s, pos); out[kind] = { ok: true }; } catch (err) { out[kind] = { ok: false, message: err.message }; }
    }
    return out;
  }

  function start(everyMs = 3 * 60000) {
    stop();
    timer = setInterval(() => { if (queue.settings('local').eta_auto) run(); }, everyMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { run, test, start, stop, state: () => last, clearTokens: () => tokens.clear() };
}

module.exports = { createEtaSubmitter, signWith, errorText };
