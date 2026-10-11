'use strict';
// A computer in "client" mode: sends every service call to the main computer's network
// server (lan-server.cjs) and turns its answers back into results or PosErrors.
const { PosError } = require('./services/index.cjs');

function createRemote({ server, deviceId, deviceName, timeout = 20000 }) {
  const base = `http://${String(server.host).trim()}:${Number(server.port)}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Pos-Key': server.key,
    'X-Pos-Device': deviceId,
    'X-Pos-Device-Name': encodeURIComponent(deviceName || ''),
  };

  async function request(pathname, body, ms = timeout) {
    let res;
    try {
      res = await fetch(base + pathname, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    } catch (err) {
      throw new PosError('SERVER_OFFLINE', err.cause?.code || err.name || err.message);
    }
    let data;
    try { data = await res.json(); } catch { throw new PosError('SERVER_OFFLINE', `HTTP ${res.status}`); }
    if (!data.ok) throw new PosError(data.code || 'ERROR', data.message || '');
    return data.data;
  }

  return {
    base,
    /** "ns.method" or a top-level function ("requirePerm"), with its arguments. */
    call: (path, args = []) => request('/api/call', { path, args }),
    exportSheets: (kind, params) => request('/api/export', { kind, params }, 120000),
    info: (ms = 5000) => request('/api/info', undefined, ms),
    /** A fresh start: forget whoever was logged in on this device. */
    reset: () => request('/api/reset', {}),
  };
}

module.exports = { createRemote };
