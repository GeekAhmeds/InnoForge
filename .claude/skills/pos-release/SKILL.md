---
name: pos-release
description: Build, version, sign and publish InnoForge POS installers and automatic updates (Windows NSIS, Linux AppImage/deb) — local builds, the GitHub Actions workflow, required secrets, and uploading to the update server. Use when shipping a new version or debugging the build/update pipeline.
---

# Releasing InnoForge POS

## How versions work
`package.json` holds `major.minor.x`. CI builds `major.minor.<run number>` so every build is newer than the last. Bump `minor`/`major` in `apps/pos/package.json` for bigger releases.

## CI (normal path) — `.github/workflows/pos-installer.yml`
- Every push touching `apps/pos/**` → tests → Windows + Linux builds → artifacts `InnoForge-POS-<OS>-<version>` (installers) and `update-server-files-<OS>-<version>`.
- Run the workflow manually (Actions → POS installer → Run workflow) with **publish** ticked to upload the update files to the server over SSH.
- Repository secrets:
  - `POS_SIGNING_KEY` — contents of `pos-license-private.pem`; without it installed apps reject the update.
  - `POS_DEPLOY_HOST`, `POS_DEPLOY_PORT`, `POS_DEPLOY_USER`, `POS_DEPLOY_KEY` (SSH private key), `POS_DEPLOY_PATH` — the folder the web server serves as `https://pos.0x01source.com:9990/updates/`.

## Local build
```bash
cd apps/pos
npm ci && npm test
POS_VERSION=0.1.200 POS_SIGNING_KEY="$(cat ~/.innoforge/pos-license-private.pem)" npm run dist:win   # or dist:linux
ls release/update   # upload the CONTENTS of this folder to the update server folder
```
`scripts/package.cjs`: Vite build → obfuscate `electron/` + `dist/` into `stage/` → electron-builder (fuses: asar integrity, only-load-from-asar, no run-as-node, no inspect) → copy `latest*.yml` + installers to `release/update` → sign (`*.sig`).
Windows builds on Linux need `wine`.

## What the update server must contain (one flat folder)
`latest.yml`, `latest-linux.yml`, `InnoForge-POS-Setup-<v>.exe(.blockmap)`, `.AppImage`, `.deb`, and every `*.sig`. Installed apps check on start and every few hours, download in the background, verify the signature, back up the DB, and install on restart.

## Checks before announcing
- `npm test` green, CI green on both OSes.
- Install the new `.exe` on a real Windows PC over the previous version: data kept, update banner works, activation still valid.
- If the update was rejected: the `.sig` is missing or signed with a different key than `electron/license-public.cjs`.
