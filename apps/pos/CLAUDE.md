# InnoForge POS — working notes

Offline desktop point-of-sale and back office for shops, supermarkets, bookstores,
restaurants/cafés and trading (wholesale/distribution) companies. Built and sold by
**Inno Source** (https://innovationsrc.com). Arabic-first (RTL) with full English.
Each installed copy is licensed to **one computer**; other computers can connect to it as clients (Settings → Network, limited by the license's `devices`). Updates come from Inno Source's server.

Read these before changing anything substantial:

- `docs/ARCHITECTURE.md` — how the app is put together, data model, main flows, security.
- `docs/FEATURES.md` — every feature, where its code lives, and what is still pending.
- `docs/SYSTEM-AR.md` — the system explained in Arabic (for the owner and new team members).
- `docs/guide.html` — the bilingual end-user / vendor guide (selling, activating, using).
- Skills in `/.claude/skills/` (repo root) — step-by-step recipes for common tasks.

## Stack

- **Electron 44** (main process: Node 24) + **React 19** + **Vite 8** renderer.
- **SQLite through `node:sqlite`** (`DatabaseSync`) — no native modules to rebuild.
- `exceljs` (Excel import/export), `electron-updater` (updates). No other runtime deps.
- Packaging: `javascript-obfuscator` → `electron-builder` (NSIS for Windows, AppImage + deb for Linux) with Electron fuses.

## Commands (run in `apps/pos`)

```bash
npm install
npm start            # build the UI and open the app (no license needed when not packaged)
npm run dev          # Vite dev server + Electron with hot reload
npm test             # all unit/integration tests (node:test) — must stay green
npm run dist:win     # protected Windows installer → release/ (needs wine on Linux)
npm run dist:linux   # AppImage + .deb → release/
npm run license -- issue --machine <ID> --customer "<name>" --days 365   # vendor license key
```

Useful env vars: `INNOFORGE_POS_DATA_DIR=/tmp/x` (separate data folder, used by tests),
`INNOFORGE_POS_FORCE_LICENSE=1` (test the activation screen from source),
`POS_VERSION=0.1.42` and `POS_SIGNING_KEY` (packaging/CI).

## Layout

```
electron/
  main.cjs            app window, IPC router (pos:call), printing, PDF, Excel, backups, updates, kitchen screen
  preload.cjs         window.posBridge — the ONLY bridge to the renderer
  db.cjs              migrations (append-only list) + transaction()
  services/index.cjs  ALL business logic (one createServices(db) factory, namespaces below)
  services/permissions.cjs   permission list + role defaults
  services/totals.cjs        tax / discount / service math
  license.cjs, license-public.cjs   Ed25519 device licensing
  editions.json, editions.cjs   license editions / add-ons / limits (shared with tools/license-generator.html)
  services/report-catalog.cjs  every report (one shape → viewer, Excel, PDF)
  updater.cjs         signed updates (generic provider)
  excel.cjs           sheet templates / parsing / export
  device.cjs          this computer's role (standalone / server = main computer / client) in userData/device.json
  lan-server.cjs      main computer: serves the services to client computers (key + device limit, per-device services)
  remote.cjs          client computer: sends service calls to the main computer
  exposed.cjs         namespaces callable from the window and from the network (EXPOSED / remoteAllowed)
  export-sheets.cjs   Excel export sheets (runs where the data is)
  eta.cjs, eta-submitter.cjs   Egyptian e-invoice / e-receipt: document JSON + serialization; token, sign, submit, poll
  kds-server.cjs, kds.html, customer.html   kitchen display + customer display (local HTTP server + standalone pages)
  rawprint.cjs        raw ESC/POS bytes to a printer (cash drawer kick)
src/
  App.jsx             shell, sidebar, context (settings, user, shift, t, withApproval, ask, printDoc…)
  pages/              one file per sidebar page (Pos, Floor, SalesInvoice, Delivery, Dashboard, Orders, Customers, Products, Purchases, Treasury, Employees, Reports, Shift, Settings…)
  components/         shared UI (ui.jsx primitives, Collect, Installments, Warehouses, Coupons, Kitchen, Modifiers, Devices, Labels, ExcelImport, Approval…)
  lib/                api.js (IPC proxy), receipt.js (printable HTML), share.js (WhatsApp), money.js, barcode.js, scale*.js, screens.js
  i18n/ar.js, en.js   flat key → text dictionaries; `{name}` placeholders
  help/topics.js      in-app user guide (Arabic + English), shown by pages/Help.jsx (F1)
test/                 node:test suites (services, license, updater, excel, scale parser, i18n)
tools/                vendor tools: license.cjs, license-generator.html (keys + reseller permits), reseller-portal.html (resellers' page), sign-update.cjs, videos/ (record tutorials + promo)
scripts/package.cjs   obfuscate → stage/ → electron-builder → release/update (signed)
docs/                 guide.html + developer docs
```

## Rules that keep the app correct

1. **Money is integer minor units** (piasters) everywhere in the DB and services. Convert only at the UI edge with `toMinor` / `fromMinor` / `formatMoney` (`src/lib/money.js`). Quantities are REAL (weights, cartons).
2. **The server prices everything.** The renderer sends product ids, quantities, units and *flags* (e.g. `price_override`); `priceCart()` re-reads prices, price lists, customer discounts and promotions from the DB. Never trust a total from the UI.
3. **Migrations are append-only** (`MIGRATIONS` in `db.cjs`). Never edit one that has shipped; add a new entry. Table rebuilds use `{ fkOff: true, sql }`. Current version: **v18**.
4. **Every service method checks access first**: `requireUser()` or `requirePerm('perm', approval, extra)`. Restricted-but-approvable actions (`discount`, `price_override`, `credit_sale`, `refund`, `void`, `expenses`, `open_drawer`) throw `APPROVAL_REQUIRED`; the UI wraps calls in `withApproval(fn)` to get a supervisor PIN and retry.
5. **Audit sensitive actions** with `audit('action_name', { entity, entityId, details, approvedBy })` and add `audit.action_name` (+ any `auditKey.*`) to both dictionaries.
6. **Errors are `PosError(CODE)`**; the UI shows `t('err.CODE')`. Add new codes to both `ar.js` and `en.js`.
7. **Every UI string goes through `t()`** and must exist in both languages — `test/i18n.test.mjs` fails otherwise.
8. **New service namespaces must be added to `EXPOSED` in `electron/exposed.cjs`** or the renderer (and client computers) cannot call them. In `main.cjs` call services through `svc.ns.method()` (always awaited) — never `services.` directly — so the same code works on a client computer. Things that must not be callable from the UI (e.g. `kds`) stay out.
9. **Use `transaction(db, fn)`** for multi-step writes. It nests (inner calls join the outer one).
10. **No `window.prompt`** (Electron does not support it) — use `ask(label, { type, initial, required })` from the app context. `window.confirm` is fine.
11. Printing is HTML → hidden window → `webContents.print` (`pos:print`). Build documents in `src/lib/receipt.js` (thermal: `page()`; A4: `a4Html`, `statementHtml`).
12. Keep the renderer free of Node: everything privileged goes through `posBridge` in `preload.cjs`.
13. **Licensed features**: a new module that is sold separately gets a key in `electron/editions.json` (and in the generator copy), a `LOCKED` entry or `requireFeature()` in the services, and `has()` around its menu/tab/buttons. Try editions from source with `INNOFORGE_POS_EDITION=basic npm start`.
14. **New report** = one entry in `services/report-catalog.cjs` + `rep.<id>` / `rep.col.*` texts; the viewer, Excel and PDF need nothing else.
15. **New screen or feature** → add/adjust its topic in `src/help/topics.js` (both languages) so the in-app guide stays complete.

## Testing

- `npm test` runs everything in `test/` against an in-memory DB (`openDatabase(':memory:')`) through the real services — add a test for every business rule you add or change.
- UI flows are checked with Playwright's `_electron` under `xvfb-run` (see the `pos-e2e-test` skill). Mock printing by replacing the `pos:print` IPC handler inside `app.evaluate`.
- The packaged app has fuses that block debugging; build a test package with `-c.electronFuses.enableNodeCliInspectArguments=true` if you must drive it.

## Releasing

CI (`.github/workflows/pos-installer.yml`) builds Windows + Linux on every push touching `apps/pos`, versions them `major.minor.<run number>`, signs the update files with the `POS_SIGNING_KEY` secret and creates a GitHub pre-release; marking it Latest ships it (the office server pulls it). See the `pos-release` skill.

## Things that are deliberately NOT done yet

- Branch computers that keep selling while the main computer is unreachable (offline sync) — see `docs/FEATURES.md` → *Pending*.
- The ETA e-invoice is built but has not been run against the live tax authority, and the USB-token signer is external — see `docs/FEATURES.md` row 17.
- Overall status (what is done, where, where we stopped): `docs/STATUS-AR.md`.
- Update server: everything runs on the office server `inno` (Hetzner dropped). `ls.0x01source.com` → office IP; the app checks `https://pos.0x01source.com:9990/updates/` (since the build after 0.1.39). `apps/license-server/deploy/install-inno.sh` adds the license server + `/updates/` there without touching existing sites; installed and running on inno (Oct 12). Shipping = mark a GitHub pre-release `pos-v…` as Latest; inno pulls it every 10 min (`updates-sync.sh`, `innoforge-updates.timer`). See `docs/SERVER-SETUP-AR.md` → «وقفنا فين؟».
