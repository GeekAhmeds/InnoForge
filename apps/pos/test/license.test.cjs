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

const { signResellerCert } = require('../electron/license.cjs');
const { entitlements } = require('../electron/editions.cjs');

test('editions: old keys stay full, editions bring their features and limits, add-ons and explicit limits apply', () => {
  const old = verifyLicense(issue(), { machine, publicKeyPem: pub });
  assert.equal(entitlements(old.payload).edition, 'full');
  assert.equal(entitlements(old.payload).features.has('employees'), true);
  const basic = entitlements({ edition: 'basic' });
  assert.equal(basic.features.size, 0);
  assert.deepEqual(basic.limits, { users: 2, warehouses: 1 });
  const rest = entitlements({ edition: 'restaurant', addons: ['employees', 'nonsense'], limits: { users: 4 } });
  assert.equal(rest.features.has('restaurant'), true);
  assert.equal(rest.features.has('employees'), true);
  assert.equal(rest.features.has('installments'), false);
  assert.deepEqual(rest.addons, ['employees']);
  assert.equal(rest.limits.users, 4);
  // Buying the warehouses add-on without a number gives a sensible default.
  assert.equal(entitlements({ edition: 'trading', addons: ['warehouses'] }).limits.warehouses, 3);
  // The license store reports what the key allows.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const store = createLicenseStore({ file: path.join(dir, 'l.json'), publicKeyPem: pub, machine });
  const st = store.activate(issue({ edition: 'market', addons: ['treasury'] }));
  assert.equal(st.edition, 'market');
  assert.ok(st.features.includes('scale') && st.features.includes('treasury') && !st.features.includes('restaurant'));
});

test('resellers: keys signed by a reseller carry the vendor-signed permit and stay inside it', () => {
  const r = crypto.generateKeyPairSync('ed25519');
  const rPriv = r.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const rPub = r.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const now = Date.now();
  const cert = signResellerCert({ id: 'R1', name: 'Al Amal', pub: rPub, editions: ['basic', 'market'], addons: ['excel'], max_days: 365, max_limits: { users: 5 }, issued: new Date(now - 86400000).toISOString(), expires: new Date(now + 90 * 86400000).toISOString() }, priv);
  const resold = (extra) => `${signLicense({ product: 'innoforge-pos', machine, customer: 'C', issued: new Date(now).toISOString(), expires: new Date(now + 365 * 86400000).toISOString(), edition: 'market', reseller: 'R1', ...extra }, rPriv)}.${cert}`;
  const ok = verifyLicense(resold({}), { machine, publicKeyPem: pub });
  assert.equal(ok.valid, true);
  assert.equal(ok.reseller.name, 'Al Amal');
  assert.equal(verifyLicense(resold({ edition: 'full' }), { machine, publicKeyPem: pub }).reason, 'RESELLER_EDITION');
  assert.equal(verifyLicense(resold({ addons: ['employees'] }), { machine, publicKeyPem: pub }).reason, 'RESELLER_ADDON');
  assert.equal(verifyLicense(resold({ expires: null }), { machine, publicKeyPem: pub }).reason, 'RESELLER_DURATION');
  assert.equal(verifyLicense(resold({ limits: { users: 9 } }), { machine, publicKeyPem: pub }).reason, 'RESELLER_LIMIT');
  assert.equal(verifyLicense(resold({ issued: new Date(now + 200 * 86400000).toISOString(), expires: new Date(now + 300 * 86400000).toISOString() }), { machine, publicKeyPem: pub }).reason, 'RESELLER_EXPIRED');
  // A reseller cannot sign a key claiming to be someone else, nor forge a permit.
  assert.equal(verifyLicense(resold({ reseller: 'R2' }), { machine, publicKeyPem: pub }).reason, 'BAD_SIGNATURE');
  const fakeCert = signResellerCert({ id: 'R1', name: 'X', pub: rPub, editions: '*', addons: '*', issued: new Date(now - 1000).toISOString() }, rPriv);
  assert.equal(verifyLicense(`${resold({}).split('.').slice(0, 2).join('.')}.${fakeCert}`, { machine, publicKeyPem: pub }).reason, 'BAD_SIGNATURE');
  // A plain key signed with the reseller key (no permit) is rejected.
  assert.equal(verifyLicense(resold({}).split('.').slice(0, 2).join('.'), { machine, publicKeyPem: pub }).reason, 'BAD_SIGNATURE');
});

test('license generator page carries the same editions as the app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'license-generator.html'), 'utf8');
  const m = html.match(/const EDITIONS_DATA = (\{[\s\S]*?\});\s*\/\/ end editions/);
  assert.ok(m, 'EDITIONS_DATA block missing in license-generator.html');
  const data = require('../electron/editions.json');
  assert.deepEqual(JSON.parse(m[1]), { features: data.features, limits: data.limits, editions: data.editions });
});
