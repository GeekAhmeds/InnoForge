'use strict';
// This computer's role when several computers share one set of data (userData/device.json):
//   standalone — its own database (the default);
//   server     — its own database, also served to the shop's other computers (the "main computer");
//   client     — no data of its own: every service call goes to the main computer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PORT = 7790;
const newKey = () => crypto.randomBytes(18).toString('base64url');

function createDeviceStore(file) {
  let cfg = null;
  function load() {
    if (cfg) return cfg;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    cfg = {
      id: /^[A-Za-z0-9-]{8,64}$/.test(saved.id || '') ? saved.id : crypto.randomUUID(),
      name: String(saved.name || os.hostname() || '').slice(0, 60),
      mode: ['server', 'client'].includes(saved.mode) ? saved.mode : 'standalone',
      server: { host: String(saved.server?.host || ''), port: Number(saved.server?.port) || DEFAULT_PORT, key: String(saved.server?.key || '') },
      serve: { port: Number(saved.serve?.port) || DEFAULT_PORT, key: String(saved.serve?.key || '') || newKey() },
    };
    if (!saved.id || !saved.serve?.key) save(cfg);
    return cfg;
  }
  function save(next) {
    cfg = next;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    return cfg;
  }
  const update = (patch) => save({ ...load(), ...patch });
  return { load, save, update, newKey };
}

module.exports = { createDeviceStore, DEFAULT_PORT };
