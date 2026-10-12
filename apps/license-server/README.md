# InnoForge License Server

Django web app where Inno Source and its partners (distributors, agents, sellers) issue
InnoForge POS license keys, with customers, prices, partner wallets, approvals, an audit
log and a JSON API. Arabic (RTL) UI.

- **Keys are the same format the POS app already verifies** (`apps/pos/electron/license.cjs`):
  the server signs with **its own** Ed25519 key, certified by Inno Source's offline vendor key
  through a permit (made in `apps/pos/tools/license-generator.html` → «تصاريح الموزّعين»).
  The vendor private key never goes on the server. Keys carry `seller` (the partner) so the
  app shows who sold them.
- Editions / add-ons / limits are read from `apps/pos/electron/editions.json` (copied into
  the Docker image); `licensing/editions.py` mirrors `editions.cjs` rules.

## Run locally
```bash
pip install -r requirements.txt
export DJANGO_DEBUG=1
python manage.py migrate && python manage.py createsuperuser   # mark it staff (createsuperuser does)
python manage.py seed_prices                                   # suggested prices from docs/PRICING-AR.md
python manage.py license_signing init                          # prints the public key for the vendor permit
python manage.py license_signing permit reseller-SERVER.cert   # or paste it on /signing/
python manage.py runserver
DJANGO_TESTING=1 python manage.py test licensing               # tests (uses node to verify keys like the app)
```

## Layout
```
config/                 settings (env vars, see .env.example), urls
licensing/models.py     Partner (+ parent), PartnerUser, Customer, License, LicenseRequest, Transaction, Price, AuditLog, ApiKey
licensing/services.py   ALL business rules (rules(), quote() with special discounts, issue/renew/upgrade/transfer/revoke,
                        marketer commissions, wallet: topup/transfer/payout/statement, requests, API keys)
licensing/signing.py    key format, JSON.stringify-compatible bytes, server key + permit
licensing/editions.py   editions.json helpers (same rules as the app)
licensing/security.py   two-step login (TOTP, recovery codes), lock-out after failed tries
licensing/auth.py       login + code step, TwoStepMiddleware, «أمان حسابي» page, admin login → portal login
licensing/views.py      portal (staff = everything; partner users = their partner and its agents)
licensing/api.py        /api/v1/* (Bearer ifk_… keys)
licensing/templates/    pages; static/licensing/app.css
```

Deploy: `docs/DEPLOY-AR.md`.
