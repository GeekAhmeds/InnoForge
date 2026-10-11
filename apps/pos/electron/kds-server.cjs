'use strict';
// Kitchen display server. Serves the kitchen screen and its small JSON API from the
// main process: to this computer only by default (a second monitor in the kitchen),
// or to the local network when enabled, so tablets can open it in a browser.
// Every API call needs the access key shown in Settings → Kitchen.
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createKdsServer({ services, customerState = () => ({ mode: 'idle' }) }) {
  let server = null;
  let status = { running: false, port: null, lan: false, error: null };
  const page = (name = 'kds.html') => fs.readFileSync(path.join(__dirname, name), 'utf8');

  const keyOk = (given) => {
    const key = services.kds.ensureKey();
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:" } : {}),
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 10_000) { reject(new Error('too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (err) { reject(err); } });
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://kds.local');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/kds')) return send(res, 200, page(), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/customer') return send(res, 200, page('customer.html'), 'text/html; charset=utf-8');
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (!keyOk(url.searchParams.get('key'))) return send(res, 403, { error: 'bad key' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return send(res, 200, services.kds.state({ stationId: url.searchParams.get('station') }));
      }
      if (req.method === 'GET' && url.pathname === '/api/customer') {
        const s = services.settings.get();
        return send(res, 200, { ...customerState(), business_name: s.business_name, language: s.language, logo: s.business_logo, message: s.display_message, currency: s.currency_symbol, decimals: s.decimals });
      }
      if (req.method === 'POST' && url.pathname === '/api/bump') {
        const body = await readJson(req);
        return send(res, 200, { ok: services.kds.bump({ id: body.id, to: body.to }) });
      }
      if (req.method === 'POST' && url.pathname === '/api/recall') {
        const body = await readJson(req);
        return send(res, 200, { ok: services.kds.recall({ stationId: body.station }) });
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      return send(res, 400, { error: err.code || 'ERROR' });
    }
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
      server = null;
    });
  }

  /** (Re)starts with the current settings. */
  async function start() {
    await stop();
    const s = services.settings.get();
    const port = Number(s.kds_port) || 7799;
    const host = s.kds_lan ? '0.0.0.0' : '127.0.0.1';
    services.kds.ensureKey();
    status = { running: false, port, lan: !!s.kds_lan, error: null };
    await new Promise((resolve) => {
      const srv = http.createServer((req, res) => { handle(req, res).catch(() => send(res, 500, { error: 'ERROR' })); });
      srv.on('error', (err) => { status = { ...status, running: false, error: err.code || err.message }; resolve(); });
      srv.listen(port, host, () => { server = srv; status = { ...status, running: true }; resolve(); });
    });
    return info();
  }

  function lanAddresses() {
    return Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => a.address);
  }

  function info() {
    const key = services.kds.ensureKey();
    const local = `http://127.0.0.1:${status.port}/kds?key=${key}`;
    return {
      ...status,
      key,
      localUrl: local,
      lanUrls: status.lan ? lanAddresses().map((ip) => `http://${ip}:${status.port}/kds?key=${key}`) : [],
    };
  }

  return { start, stop, info };
}

module.exports = { createKdsServer };
