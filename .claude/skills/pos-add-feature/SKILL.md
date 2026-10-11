---
name: pos-add-feature
description: Checklist for adding or changing a feature in InnoForge POS (apps/pos) end to end — service logic, permissions, audit, IPC exposure, React UI, Arabic/English text, tests and docs. Use whenever a POS change touches business rules or screens.
---

# Adding a feature to InnoForge POS

Work in `apps/pos`. Read `apps/pos/CLAUDE.md` first if you have not this session.

## 1. Data
- Need new columns/tables? Follow the `pos-db-migration` skill (append a migration, never edit a shipped one).
- Money = integer minor units; quantities = REAL; dates = `'YYYY-MM-DD HH:MM:SS'` local (`datetime('now','localtime')`).

## 2. Service (`electron/services/index.cjs`)
- Add methods to an existing namespace or a new `const thing = { ... }` and return it from `createServices`.
- First line of every method: `requireUser()` or `requirePerm('perm', approval, extra)`.
  - New permission? Add it to `PERMISSIONS` and `ROLE_DEFAULTS` in `services/permissions.cjs`, plus `perm.<name>` text in both dictionaries.
  - Approvable by a supervisor? Add it to `APPROVABLE`.
- Validate input with `int / num / str`; throw `new PosError('CODE')` and add `err.CODE` to both dictionaries.
- Multi-row writes inside `transaction(db, () => { ... })`.
- Sensitive actions: `audit('action', { entity, entityId, approvedBy, details })` + `audit.action` text (and `auditKey.*` for detail keys; money keys go in `AUDIT_MONEY` in `src/pages/Settings.jsx`).
- Never accept prices/totals from the renderer — recompute (see `priceCart`).

## 3. Expose it
- New namespace → add to `EXPOSED` in `electron/main.cjs` (unless it must not be reachable from the UI).
- Something needing OS access (files, dialogs, printers, devices)? Add an `ipcMain.handle('pos:xyz')` in `main.cjs`, a method in `preload.cjs`, and a wrapper in `src/lib/api.js`.

## 4. UI (`src/`)
- Call `api.<ns>.<method>(arg)`; it throws errors with `.code`. Show them with `notify(tErr(err), 'error')`.
- Wrap restricted actions: `await withApproval((approval) => api.x.y({ ...args, approval }))` and ignore `err.code === 'CANCELLED'`.
- Ask for text/number with `await ask(label, { type, initial, required })` — never `window.prompt`.
- Use `Modal`, `Field`, `Toggle`, `useLoad` from `components/ui.jsx`; hide buttons with `can('perm')`.
- Printable output → a function in `src/lib/receipt.js`, printed with `printDoc(html, printerName)`.
- Every string through `t('key')` — see `pos-i18n`.

## 5. Tests
- Add a `test(...)` to `test/services.test.cjs` using `setup()` (in-memory DB, logged-in admin) covering the rules, permissions (log in as a cashier: `s.users.save` + `s.auth.login`) and error codes (`tryCode`).
- `npm test` must pass (it also checks every `t()` key exists in both languages).
- For screens, run an E2E check (`pos-e2e-test`) and look at the screenshots.
- `npx vite build` must succeed.

## 6. Docs
- Update `apps/pos/docs/FEATURES.md` (feature + code location), and `docs/guide.html` (both the `lang="ar"` and `lang="en"` blocks) when users or the vendor need to know about it.
- Commit with a message that explains what users get.
