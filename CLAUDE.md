# InnoForge

Monorepo for InnoForge apps. The first (and currently only) app is **InnoForge POS** in
`apps/pos` — an offline Electron point-of-sale sold by Inno Source.

- Start with `apps/pos/CLAUDE.md` (rules, commands, layout), then `apps/pos/docs/ARCHITECTURE.md`
  and `apps/pos/docs/FEATURES.md`. An Arabic overview is in `apps/pos/docs/SYSTEM-AR.md`.
- Task recipes live in `.claude/skills/`:
  - `pos-add-feature` — end-to-end checklist for a new feature (service → IPC → UI → i18n → tests).
  - `pos-db-migration` — changing the database schema safely.
  - `pos-i18n` — adding Arabic/English UI text.
  - `pos-e2e-test` — driving the real app with Playwright to verify UI flows.
  - `pos-release` — versions, installers, signed updates, publishing to the update server.
  - `pos-license` — issuing and renewing customer license keys.
- CI: `.github/workflows/pos-installer.yml` builds Windows and Linux installers on every push to `apps/pos`.
- Never commit `*.pem` files (the vendor private key signs licenses and updates).
