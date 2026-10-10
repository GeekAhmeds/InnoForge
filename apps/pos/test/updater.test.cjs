'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signUpdate, readLatest } = require('../tools/sign-update.cjs');

// electron is not available under plain node; the signature helpers do not need it.
require.cache[require.resolve('electron')] = { exports: { app: {}, net: {} } };
const { verifyUpdateSignature } = require('../electron/updater.cjs');

const LATEST = `version: 0.1.7
files:
  - url: InnoForge-POS-Setup-0.1.7.exe
    sha512: abc123+/==
    size: 100
path: InnoForge-POS-Setup-0.1.7.exe
sha512: abc123+/==
releaseDate: '2026-10-10T00:00:00.000Z'
`;

test('signed update verifies; tampered version/hash or other key is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  fs.writeFileSync(path.join(dir, 'latest.yml'), LATEST);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  assert.deepEqual(readLatest(dir), { version: '0.1.7', url: 'InnoForge-POS-Setup-0.1.7.exe', sha512: 'abc123+/==' });
  const { file } = signUpdate(dir, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const signature = fs.readFileSync(file, 'utf8');
  assert.equal(path.basename(file), 'InnoForge-POS-Setup-0.1.7.exe.sig');
  assert.equal(verifyUpdateSignature({ version: '0.1.7', sha512: 'abc123+/==', signature, publicKeyPem: pub }), true);
  assert.equal(verifyUpdateSignature({ version: '0.1.8', sha512: 'abc123+/==', signature, publicKeyPem: pub }), false);
  assert.equal(verifyUpdateSignature({ version: '0.1.7', sha512: 'evil', signature, publicKeyPem: pub }), false);
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(verifyUpdateSignature({ version: '0.1.7', sha512: 'abc123+/==', signature, publicKeyPem: other }), false);
  assert.equal(verifyUpdateSignature({ version: '0.1.7', sha512: 'abc123+/==', signature: 'garbage', publicKeyPem: pub }), false);
});
