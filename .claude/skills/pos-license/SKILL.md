---
name: pos-license
description: Issue, renew or move InnoForge POS customer licenses (one computer per key, Ed25519-signed, with duration) using tools/license.cjs or tools/license-generator.html, and handle key-pair safety. Use when a customer needs activation, renewal, or a new PC.
---

# Customer licenses

A license key is `base64url(payload).base64url(signature)` with payload
`{ product: 'innoforge-pos', machine, customer, issued, expires }`, signed with the vendor's
Ed25519 private key. The app holds only the public key (`electron/license-public.cjs`).

## One-time: the key pair
```bash
cd apps/pos && npm run license -- keygen     # writes ~/.innoforge/pos-license-private.pem and updates license-public.cjs
```
Back up the `.pem` somewhere safe and offline. **Never commit it** (`*.pem` is git-ignored) and never put it on a customer PC. Losing it means existing licenses still work but no new keys or updates can be signed; leaking it lets anyone activate copies.

## Issue a key
1. Customer installs and opens the app → activation screen shows the **Machine ID** (e.g. `7F3A-91C2-04BE-D5E8-2A6F`).
2. Issue:
   ```bash
   npm run license -- issue --machine 7F3A-91C2-04BE-D5E8-2A6F --customer "مكتبة النور" --days 365
   # omit --days for a lifetime key; --days 14 for a trial
   ```
   Or open `tools/license-generator.html` in a browser (works offline), load the `.pem`, paste the Machine ID.
3. Send the key; the customer pastes it on the activation screen.

## Renewal / new computer
- Renewal: issue a new key for the same Machine ID; they paste it in Settings → Data (license section) or on the expiry screen.
- New PC or Windows reinstall: the Machine ID changes → issue a key for the new ID. Restore their data from a backup file.

## Testing activation from source
`INNOFORGE_POS_FORCE_LICENSE=1 npm start`; `npm run license -- machine` prints this computer's ID.
