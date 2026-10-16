# InnoForge

Monorepo for InnoForge apps:
- **InnoForge POS** in `apps/pos` — an offline Electron point-of-sale sold by Inno Source.
- **License server** in `apps/license-server` — Django portal where Inno Source and its partners issue POS license keys (read its `CLAUDE.md`).
- **Website** in `apps/website` — the public Arabic landing page (features, screenshots, download, activation, contact), served next to the portal (see its `README.md`).

- Start with `apps/pos/CLAUDE.md` (rules, commands, layout), then `apps/pos/docs/ARCHITECTURE.md`
  and `apps/pos/docs/FEATURES.md`. An Arabic overview is in `apps/pos/docs/SYSTEM-AR.md`.
- **Where the project stands** (what is done, where it lives, what is still open): `apps/pos/docs/STATUS-AR.md`.
- **Shipping a POS version to customers + fixing update problems** (Arabic, for the owner): `apps/pos/docs/RELEASE-AR.md`.
- Task recipes live in `.claude/skills/`:
  - `pos-add-feature` — end-to-end checklist for a new feature (service → IPC → UI → i18n → tests).
  - `pos-db-migration` — changing the database schema safely.
  - `pos-i18n` — adding Arabic/English UI text.
  - `pos-e2e-test` — driving the real app with Playwright to verify UI flows.
  - `pos-release` — versions, installers, signed updates, publishing to the update server.
  - `pos-license` — issuing and renewing customer license keys.
- CI: `.github/workflows/pos-installer.yml` builds Windows and Linux installers on every push to `apps/pos`; `license-server.yml` tests the server and builds its Docker image.
- Never commit `*.pem` files (the vendor private key signs licenses and updates).
