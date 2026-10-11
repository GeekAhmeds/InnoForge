'use strict';
// The main computer's network server: lets the shop's other computers (cashiers, branches
// over a VPN such as Tailscale) work on this computer's database. Each connected computer
// gets its own services instance (its own logged-in user, open shift and printer settings);
// all of them share the one database, so stock, invoices and balances are always the same.
//
// Every request carries the access key from Settings → Network and the device id; a new
// device is admitted only while the license's device limit allows it, and the owner can
// block a device. Only the namespaces in exposed.cjs can be called.
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { PosError } = require('./services/index.cjs');
const { remoteAllowed } = require('./exposed.cjs');
const { exportSheets } = require('./export-sheets.cjs');

const MAX_BODY = 30 * 1024 * 1024; // big enough for an Excel import of a large catalogue

function createLanServer({ local, makeServices, getConfig, licenseOk, info = () => ({}), onCall = () => {} }) {
  let server = null;
  let status = { running: false, port: null, error: null };
  const instances = new Map(); // device id → services
  const failures = new Map(); // ip → { n, until }

  const keyOk = (given) => {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(String(getConfig().serve.key || ''));
    return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  function servicesFor(id) {
    let s = instances.get(id);
    if (!s) { s = makeServices(id); instances.set(id, s); }
    return s;
  }

  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, err, code = 400) => send(res, code, { ok: false, code: err.code || 'ERROR', message: err instanceof PosError ? err.message : '' });

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new PosError('TOO_LARGE')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new PosError('BAD_REQUEST')); } });
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const ip = req.socket.remoteAddress || '';
    const url = new URL(req.url, 'http://pos.local');
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { ok: false, code: 'NOT_FOUND' });
    // Slow down guessing: 10 wrong keys from one address lock it out for a minute.
    const f = failures.get(ip);
    if (f?.until > Date.now()) return fail(res, new PosError('NETWORK_KEY'), 429);
    if (!keyOk(req.headers['x-pos-key'])) {
      const n = (f && f.until === 0 ? f.n : 0) + 1;
      failures.set(ip, { n, until: n >= 10 ? Date.now() + 60000 : 0 });
      return fail(res, new PosError('NETWORK_KEY'), 403);
    }
    failures.delete(ip);
    const id = String(req.headers['x-pos-device'] || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || id === 'local') return fail(res, new PosError('BAD_REQUEST'));
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-pos-device-name'] || '')).slice(0, 60); } catch { /* ignore */ }

    try {
      local.admitDevice(id, name);
      if (req.method === 'GET' && url.pathname === '/api/info') {
        return send(res, 200, { ok: true, data: { app: 'innoforge-pos', licensed: licenseOk(), entitlements: local.license.get(), device: { id, name }, ...info() } });
      }
      if (req.method !== 'POST') return send(res, 404, { ok: false, code: 'NOT_FOUND' });
      const body = await readJson(req);
      if (url.pathname === '/api/reset') {
        instances.delete(id);
        return send(res, 200, { ok: true, data: true });
      }
      if (!licenseOk()) throw new PosError('LICENSE_REQUIRED');
      const s = servicesFor(id);
      if (url.pathname === '/api/export') {
        return send(res, 200, { ok: true, data: exportSheets(s, String(body.kind || ''), body.params || {}) });
      }
      if (url.pathname === '/api/call') {
        const path = String(body.path || '');
        if (!remoteAllowed(path)) throw new PosError('UNKNOWN_METHOD', path);
        const [ns, method] = path.split('.');
        const owner = method ? s[ns] : s;
        const fn = owner?.[method || ns];
        if (typeof fn !== 'function') throw new PosError('UNKNOWN_METHOD', path);
        const args = Array.isArray(body.args) ? body.args.slice(0, 3) : [];
        const data = fn.apply(owner, args);
        onCall(ns, method, args[0]);
        return send(res, 200, { ok: true, data: data === undefined ? null : data });
      }
      return send(res, 404, { ok: false, code: 'NOT_FOUND' });
    } catch (err) {
      if (!(err instanceof PosError)) console.error('network server', err);
      return fail(res, err);
    }
  }

  function stop() {
    return new Promise((resolve) => {
      status = { ...status, running: false };
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
      server = null;
    });
  }

  async function start() {
    await stop();
    const port = getConfig().serve.port;
    status = { running: false, port, error: null };
    await new Promise((resolve) => {
      const srv = http.createServer((req, res) => { handle(req, res).catch((err) => fail(res, err, 500)); });
      srv.on('error', (err) => { status = { ...status, running: false, error: err.code || err.message }; resolve(); });
      srv.listen(port, '0.0.0.0', () => { server = srv; status = { ...status, running: true }; resolve(); });
    });
    return state();
  }

  const addresses = () => Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);

  const state = () => ({ ...status, addresses: addresses(), connected: instances.size });

  /** A device was blocked: drop its session right away. */
  const forget = (id) => instances.delete(id);

  return { start, stop, state, forget, handle };
}

module.exports = { createLanServer };
