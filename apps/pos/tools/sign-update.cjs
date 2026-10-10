#!/usr/bin/env node
'use strict';
// Signs an update so installed apps accept it. Reads latest.yml from the release
// folder and writes "<installer>.sig" next to the installer.
//
//   node tools/sign-update.cjs release/update --key ~/.innoforge/pos-license-private.pem
//   (or set POS_SIGNING_KEY to the PEM text, as in CI secrets)
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { updateMessage } = require('../electron/updater.cjs');

function readLatest(dir) {
  const yml = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  const pick = (re) => (yml.match(re) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
  // latest.yml lists the installer under "files"; the first url/sha512 pair is the installer.
  const version = pick(/^version:\s*(.+)$/m);
  const url = pick(/^\s*-\s*url:\s*(.+)$/m);
  const sha512 = pick(/^\s+sha512:\s*(.+)$/m);
  if (!version || !url || !sha512) throw new Error('latest.yml is missing version/url/sha512');
  return { version, url, sha512 };
}

function signUpdate(dir, privateKeyPem) {
  const { version, url, sha512 } = readLatest(dir);
  const sig = crypto.sign(null, Buffer.from(updateMessage(version, sha512)), crypto.createPrivateKey(privateKeyPem)).toString('base64');
  const out = path.join(dir, `${url}.sig`);
  fs.writeFileSync(out, sig + '\n');
  return { version, file: out };
}

function loadKey(explicit) {
  if (process.env.POS_SIGNING_KEY) return process.env.POS_SIGNING_KEY;
  const file = explicit || process.env.POS_SIGNING_KEY_FILE || path.join(os.homedir(), '.innoforge', 'pos-license-private.pem');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

module.exports = { signUpdate, loadKey, readLatest };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'release', 'update');
  const k = argv.indexOf('--key');
  const key = loadKey(k >= 0 ? argv[k + 1] : null);
  if (!key) {
    console.error('No signing key: pass --key <private.pem> or set POS_SIGNING_KEY.');
    process.exit(1);
  }
  const { version, file } = signUpdate(dir, key);
  console.log(`Signed v${version}: ${file}`);
}
