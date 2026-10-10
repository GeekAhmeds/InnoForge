'use strict';
// Automatic updates from the vendor's server (electron-updater, "generic" provider).
//
// Offline-first: when there is no internet the check fails quietly and the app keeps
// working. When an update is found it downloads in the background, and it is only
// allowed to install if its hash carries a valid Ed25519 signature from the vendor key
// (the same key that signs licenses). A hacked or spoofed server cannot push its own
// installer.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, net } = require('electron');

const CHECK_DELAY_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const updateMessage = (version, sha512) => `innoforge-pos-update:${version}:${sha512}`;

function verifyUpdateSignature({ version, sha512, signature, publicKeyPem }) {
  try {
    return crypto.verify(null, Buffer.from(updateMessage(version, sha512)), crypto.createPublicKey(publicKeyPem), Buffer.from(String(signature).trim(), 'base64'));
  } catch {
    return false;
  }
}

function createUpdater({ publicKeyPem, onState }) {
  let state = { status: 'idle', current: app.getVersion() };
  const set = (patch) => {
    state = { ...state, ...patch, current: app.getVersion() };
    onState?.(state);
  };

  // Running from source there is nothing to update.
  if (!app.isPackaged && process.env.INNOFORGE_POS_FORCE_UPDATER !== '1') {
    return { state: () => ({ ...state, status: 'disabled' }), check: async () => state, install: () => false };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // switched on only after the signature checks out
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  if (process.env.INNOFORGE_POS_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.INNOFORGE_POS_UPDATE_URL });
  }
  // Same base URL electron-updater reads its latest.yml from (written into resources at build time).
  const feedUrl = () => {
    if (process.env.INNOFORGE_POS_UPDATE_URL) return process.env.INNOFORGE_POS_UPDATE_URL;
    try {
      const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
      return (yml.match(/^url:\s*(.+)$/m) || [])[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
    } catch {
      return '';
    }
  };

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, notes: info.releaseNotes || '', percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err?.message || err).slice(0, 300), checkedAt: Date.now() }));

  autoUpdater.on('update-downloaded', async (info) => {
    const file = info.files?.[0];
    const base = String(feedUrl()).replace(/\/?$/, '/');
    try {
      const res = await net.fetch(new URL(`${encodeURIComponent(file.url)}.sig`, base).toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`signature HTTP ${res.status}`);
      const signature = await res.text();
      if (!verifyUpdateSignature({ version: info.version, sha512: file.sha512, signature, publicKeyPem })) throw new Error('bad signature');
      autoUpdater.autoInstallOnAppQuit = true;
      set({ status: 'ready', version: info.version, notes: info.releaseNotes || '' });
    } catch (err) {
      set({ status: 'rejected', version: info.version, error: String(err?.message || err) });
    }
  });

  const check = async () => {
    if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
    try { await autoUpdater.checkForUpdates(); } catch { /* reported through the 'error' event */ }
    return state;
  };

  setTimeout(check, CHECK_DELAY_MS);
  setInterval(check, CHECK_EVERY_MS);

  return {
    state: () => state,
    check,
    install() {
      if (state.status !== 'ready') return false;
      // isSilent=true keeps the user's install folder and choices; restart afterwards.
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return true;
    },
  };
}

module.exports = { createUpdater, verifyUpdateSignature, updateMessage };
