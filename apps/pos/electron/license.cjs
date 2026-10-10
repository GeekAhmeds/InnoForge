'use strict';
// Offline device licensing.
//
// Each computer has a Machine ID derived from the OS installation id. The
// vendor signs a license for that Machine ID with a private Ed25519 key
// (tools/license.cjs); the app only holds the public key, so it can verify a
// license but never create one. No internet is involved at any point.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function rawMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(f)) {
          const id = fs.readFileSync(f, 'utf8').trim();
          if (id) return id;
        }
      }
    }
  } catch {
    // fall through to the weaker fallback below
  }
  return `${os.hostname()}|${os.cpus()[0]?.model || ''}|${os.totalmem()}`;
}

/** Short, human-readable id, e.g. "7F3A-91C2-04BE-D5E8-2A6F". */
function machineId(raw = rawMachineId()) {
  const hex = crypto.createHash('sha256').update(`innoforge-pos:${String(raw).toLowerCase()}`).digest('hex').slice(0, 20).toUpperCase();
  return hex.match(/.{4}/g).join('-');
}

const normalizeId = (id) => String(id || '').toUpperCase().replace(/[^0-9A-F]/g, '');

function signLicense(payload, privateKeyPem) {
  const body = Buffer.from(JSON.stringify(payload));
  const sig = crypto.sign(null, body, crypto.createPrivateKey(privateKeyPem));
  return `${b64url(body)}.${b64url(sig)}`;
}

/**
 * @returns {{valid: boolean, reason?: string, payload?: object}}
 * reasons: EMPTY | MALFORMED | BAD_SIGNATURE | WRONG_MACHINE | EXPIRED | CLOCK
 */
function verifyLicense(key, { machine, publicKeyPem, now = Date.now(), lastSeen = 0 }) {
  const text = String(key || '').replace(/\s+/g, '');
  if (!text) return { valid: false, reason: 'EMPTY' };
  const [bodyB64, sigB64, extra] = text.split('.');
  if (!bodyB64 || !sigB64 || extra !== undefined) return { valid: false, reason: 'MALFORMED' };
  let body;
  let payload;
  try {
    body = Buffer.from(bodyB64, 'base64url');
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }
  let ok = false;
  try {
    ok = crypto.verify(null, body, crypto.createPublicKey(publicKeyPem), Buffer.from(sigB64, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'BAD_SIGNATURE' };
  if (payload.product !== 'innoforge-pos') return { valid: false, reason: 'BAD_SIGNATURE' };
  if (normalizeId(payload.machine) !== normalizeId(machine)) return { valid: false, reason: 'WRONG_MACHINE', payload };
  if (payload.expires) {
    // A clock moved far behind the last time we ran means someone is dodging expiry.
    if (lastSeen && now < lastSeen - 36 * 3600 * 1000) return { valid: false, reason: 'CLOCK', payload };
    if (now > Date.parse(payload.expires)) return { valid: false, reason: 'EXPIRED', payload };
  }
  return { valid: true, payload };
}

/** Stores the license next to the database and tracks the last time the app ran. */
function createLicenseStore({ file, publicKeyPem, machine = machineId() }) {
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const write = (data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

  function status() {
    const data = read();
    const result = verifyLicense(data.key, { machine, publicKeyPem, lastSeen: data.lastSeen });
    if (result.valid) {
      const now = Date.now();
      if (!data.lastSeen || now > data.lastSeen) write({ ...data, lastSeen: now });
    }
    return {
      machine,
      valid: result.valid,
      reason: result.valid ? null : data.key ? result.reason : 'EMPTY',
      customer: result.payload?.customer || null,
      expires: result.payload?.expires || null,
    };
  }

  function activate(key) {
    const result = verifyLicense(key, { machine, publicKeyPem });
    if (!result.valid) return { ...status(), valid: false, reason: result.reason };
    write({ key: String(key).replace(/\s+/g, ''), lastSeen: Date.now() });
    return status();
  }

  return { status, activate, machine };
}

module.exports = { machineId, rawMachineId, signLicense, verifyLicense, createLicenseStore, normalizeId };
