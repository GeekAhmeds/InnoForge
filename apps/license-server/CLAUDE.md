# InnoForge License Server — working notes

Django 5 portal for issuing InnoForge POS license keys by Inno Source staff and partners
(distributors → agents/sellers), with customers, prices, wallets, approvals, audit log, JSON API.
Read `README.md` (layout, commands) and `docs/DEPLOY-AR.md` (deploy, security idea).

Rules:
1. **All business rules live in `licensing/services.py`**; views/API only call it and show `LicenseError` messages (Arabic).
2. **Key format must stay byte-compatible with the POS app** (`apps/pos/electron/license.cjs`): `signing.js_json` (= JSON.stringify), `js_iso` (= toISOString), payload field order product, machine, customer, issued, expires, edition, addons?, limits?, reseller, seller?. The test `test_server_key_is_accepted_by_the_pos_app` runs the app's verifyLicense through node — keep it green.
3. `editions.py` mirrors `apps/pos/electron/editions.cjs` (`effective_limits` = entitlements, `permit_allows` = resellerAllows). Change both together.
4. Scope: staff without a PartnerUser = Inno Source (everything); partner users see `partner.scope_ids()` only. Every view uses the `scoped_*` helpers.
5. Money: Decimal, 2 places; the wallet (`Transaction`) is append-only; balance = sum.
6. The vendor private key never goes on the server; only the server key + its permit (`KEYS_DIR`).
7. Tests: `DJANGO_TESTING=1 python manage.py test licensing`. New migration for every model change (`makemigrations`; CI checks none are missing).
