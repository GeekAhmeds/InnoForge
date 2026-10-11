---
name: pos-license
description: Issue, renew, upgrade or move InnoForge POS customer licenses (one computer per key, Ed25519-signed, with duration, edition, add-ons and limits), set up resellers with signed permits, and handle key-pair safety. Use when a customer needs activation, renewal, an upgrade, a new PC, or when onboarding a reseller.
---

# Customer licenses

A license key is `base64url(payload).base64url(signature)` with payload
`{ product: 'innoforge-pos', machine, customer, issued, expires, edition, addons?, limits?, reseller? }`,
signed with the vendor's Ed25519 private key. The app holds only the public key (`electron/license-public.cjs`).
A reseller-issued key has two more parts: `….<permit body>.<permit sig>` (the permit is signed by the vendor).

## Editions, add-ons, limits
- Defined once in `apps/pos/electron/editions.json` (features, editions, default limits); `editions.cjs` turns a payload into
  `{ edition, features:Set, limits }`. `tools/license-generator.html` embeds a copy — `test/license.test.cjs` fails if they differ,
  so after editing the JSON, paste the new `{features, limits, editions}` into `EDITIONS_DATA` in the generator.
- Keys without `edition` (issued before editions) are treated as **full**.
- Enforcement: `services/index.cjs` → `LOCKED` map (whole namespaces) + inline `requireFeature()` (coupons, gift cards, delivery,
  dine-in/modifiers, settings toggles) + `checkLimit()` (users, warehouses). UI hides with `has(feature)` from `src/lib/features.js`.
  Errors: `FEATURE_LOCKED`, `LIMIT_USERS`, `LIMIT_WAREHOUSES`.
- Try an edition from source: `INNOFORGE_POS_EDITION=basic npm start`.
- Adding a feature: key in `editions.json` (+ editions that include it) → map it in `LOCKED`/`requireFeature` → `has()` in the UI →
  `feat.<key>` text comes from the JSON (add to both dictionaries) → list it in `FEATURES` in `src/components/License.jsx`.

## One-time: the key pair
```bash
cd apps/pos && npm run license -- keygen     # writes ~/.innoforge/pos-license-private.pem and updates license-public.cjs
```
Back up the `.pem` somewhere safe and offline. **Never commit it** (`*.pem` is git-ignored) and never put it on a customer PC. Losing it means existing licenses still work but no new keys or updates can be signed; leaking it lets anyone activate copies.

## Issue a key
1. Customer installs and opens the app → activation screen shows the **Machine ID** (e.g. `7F3A-91C2-04BE-D5E8-2A6F`).
2. Issue:
   ```bash
   npm run license -- issue --machine 7F3A-91C2-04BE-D5E8-2A6F --customer "مكتبة النور" --days 365 \
        --edition market [--addons warehouses,employees] [--users 8] [--warehouses 3]
   # omit --days for a lifetime key; --days 14 --edition full for a trial
   ```
   Or open `tools/license-generator.html` in a browser (works offline), load the `.pem`, paste the Machine ID.
3. Send the key; the customer pastes it on the activation screen.

## Renewal / upgrade / new computer
- Renewal or upgrade (new edition / add-on / limits): issue a new key for the same Machine ID; they paste it in
  Settings → License → Update key (or on the expiry screen). Features unlock at once; data is untouched.
- New PC or Windows reinstall: the Machine ID changes → issue a key for the new ID. Restore their data from a backup file.

## Testing activation from source
`INNOFORGE_POS_FORCE_LICENSE=1 npm start`; `npm run license -- machine` prints this computer's ID.

## Resellers
1. Reseller: `npm run license -- reseller-keygen --key ~/.innoforge/reseller.pem` → sends `reseller.pub.txt`.
2. Vendor: `npm run license -- reseller-cert --pub reseller.pub.txt --id R001 --name "…" --editions basic,market --addons warehouses --max-days 365 --max-users 10 --valid-days 90`
   → `reseller-R001.cert` (send it back). Keep permits short and renew them as the reseller pays.
3. Reseller issues keys: CLI `issue --key reseller.pem --cert reseller-R001.cert …` or the generator page («أنا موزّع»).
4. The app verifies permit (vendor key) → key (reseller key) → payload within the permit (`resellerAllows`), and shows the seller.
5. Revoke for new keys: add the id to `revoked_resellers` in `editions.json` and ship an update.
Prices and partner tiers proposal: `apps/pos/docs/PRICING-AR.md`.
