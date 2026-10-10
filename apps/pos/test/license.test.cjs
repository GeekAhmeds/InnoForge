'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { machineId, signLicense, verifyLicense, createLicenseStore } = require('../electron/license.cjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const machine = machineId('test-machine');
const issue = (extra = {}) => signLicense({ product: 'innoforge-pos', machine, customer: 'Shop', issued: new Date().toISOString(), expires: null, ...extra }, priv);

test('machine id is stable and formatted', () => {
  assert.equal(machineId('abc'), machineId('ABC'));
  assert.match(machineId(), /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
});

test('valid lifetime license', () => {
  const r = verifyLicense(issue(), { machine, publicKeyPem: pub });
  assert.equal(r.valid, true);
  assert.equal(r.payload.customer, 'Shop');
});

test('rejects other machine, tampering, foreign key, expiry and clock rollback', () => {
  assert.equal(verifyLicense(issue(), { machine: machineId('other'), publicKeyPem: pub }).reason, 'WRONG_MACHINE');
  const [body, sig] = issue().split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), expires: null, customer: 'X' })).toString('base64url');
  assert.equal(verifyLicense(`${forged}.${sig}`, { machine, publicKeyPem: pub }).reason, 'BAD_SIGNATURE');
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const foreign = signLicense({ product: 'innoforge-pos', machine }, other);
  assert.equal(verifyLicense(foreign, { machine, publicKeyPem: pub }).reason, 'BAD_SIGNATURE');
  assert.equal(verifyLicense('garbage', { machine, publicKeyPem: pub }).reason, 'MALFORMED');
  const expired = issue({ expires: new Date(Date.now() - 1000).toISOString() });
  assert.equal(verifyLicense(expired, { machine, publicKeyPem: pub }).reason, 'EXPIRED');
  const future = issue({ expires: new Date(Date.now() + 30 * 86400000).toISOString() });
  assert.equal(verifyLicense(future, { machine, publicKeyPem: pub }).valid, true);
  assert.equal(verifyLicense(future, { machine, publicKeyPem: pub, lastSeen: Date.now() + 5 * 86400000 }).reason, 'CLOCK');
});

test('store persists activation and survives restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lic-')), 'license.json');
  const store = createLicenseStore({ file, publicKeyPem: pub, machine });
  assert.equal(store.status().valid, false);
  assert.equal(store.activate('nope').valid, false);
  assert.equal(store.activate(issue()).valid, true);
  assert.equal(createLicenseStore({ file, publicKeyPem: pub, machine }).status().valid, true);
  assert.equal(createLicenseStore({ file, publicKeyPem: pub, machine: machineId('copied-to-another-pc') }).status().reason, 'WRONG_MACHINE');
});
