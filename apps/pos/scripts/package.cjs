#!/usr/bin/env node
'use strict';
// Builds a protected installer:
//   1. builds the UI with Vite
//   2. copies the app into ./stage with every JS file obfuscated
//   3. runs electron-builder on ./stage (asar + integrity fuses, see package.json "build")
//
//   4. collects the files to upload to the update server into release/update and signs them
//
//   node scripts/package.cjs --win | --mac | --linux [--dir]
//   POS_VERSION=0.1.42   overrides the version (CI sets major.minor from package.json + run number)
//   POS_SIGNING_KEY      PEM text of the vendor private key used to sign the update (or ~/.innoforge/…pem)
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { signUpdate, loadKey } = require('../tools/sign-update.cjs');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'stage');
const pkg = require(path.join(ROOT, 'package.json'));

// Main process: strongest settings — this is where licensing and business rules live.
const MAIN_OPTIONS = {
  target: 'node',
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  transformObjectKeys: true,
  numbersToExpressions: true,
  unicodeEscapeSequence: false,
};

// Renderer: lighter settings so the UI stays fast on old cashier PCs.
const RENDERER_OPTIONS = {
  target: 'browser',
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  selfDefending: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  unicodeEscapeSequence: false,
};

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function obfuscateFile(src, dest, options) {
  const code = fs.readFileSync(src, 'utf8');
  const out = JavaScriptObfuscator.obfuscate(code, { ...options, sourceMap: false }).getObfuscatedCode();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}

function copyTree(srcDir, destDir, transform) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyTree(src, dest, transform);
    else if (!transform(src, dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

const platform = ['--win', '--mac', '--linux'].find((f) => process.argv.includes(f)) || '';
const dirOnly = process.argv.includes('--dir');

run('npx vite build');

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE);
copyTree(path.join(ROOT, 'electron'), path.join(STAGE, 'electron'), (src, dest) => {
  if (!/\.c?js$/.test(src)) return false;
  obfuscateFile(src, dest, MAIN_OPTIONS);
  return true;
});
copyTree(path.join(ROOT, 'dist'), path.join(STAGE, 'dist'), (src, dest) => {
  if (!src.endsWith('.js')) return false;
  obfuscateFile(src, dest, RENDERER_OPTIONS);
  return true;
});
const version = process.env.POS_VERSION || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version "${version}" (expected x.y.z)`);
const installed = (name) => require(path.join(ROOT, 'node_modules', name, 'package.json')).version;

// Minimal manifest: runtime dependencies only, no scripts, nothing that reveals the build.
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: pkg.name,
  productName: pkg.productName,
  version,
  description: pkg.description,
  author: pkg.author,
  license: 'UNLICENSED',
  main: pkg.main,
  dependencies: Object.fromEntries(Object.keys(pkg.dependencies || {}).map((d) => [d, installed(d)])),
}, null, 2));
execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', { cwd: STAGE, stdio: 'inherit' });

run(`npx electron-builder ${platform} ${dirOnly ? '--dir' : ''} --publish never --config.directories.app=stage`);

// Everything the update server needs, in one folder: upload its contents as-is.
if (!dirOnly && fs.existsSync(path.join(ROOT, 'release', 'latest.yml'))) {
  const out = path.join(ROOT, 'release', 'update');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  for (const f of fs.readdirSync(path.join(ROOT, 'release'))) {
    if (f === 'latest.yml' || /\.(exe|blockmap)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'release', f), path.join(out, f));
  }
  const key = loadKey();
  if (key) console.log(`Signed update v${signUpdate(out, key).version}`);
  else console.warn('⚠ No signing key found: installed apps will REJECT this update until it is signed (tools/sign-update.cjs).');
  console.log(`Upload the contents of ${out} to the update server.`);
}
