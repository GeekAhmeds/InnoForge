# InnoForge POS — public website

Static Arabic (RTL) landing page for InnoForge POS by Inno Source: features, business types,
screenshots, editions, download, how to activate, partners, FAQ and contact.

- Served by nginx on the office server `inno` at `https://pos.0x01source.com:9990/`
  (`/` → `index.html`, `/site/` → this folder). Set up by `apps/license-server/deploy/install-inno.sh`;
  the license-server portal lives at `/portal/` on the same host.
- **Download links are live**: `app.js` reads `/updates/latest.yml` and `/updates/latest-linux.yml`
  (the files the POS app updates from), so the page always offers the version published there.
- **Contact form** posts to `/api/v1/lead` (license server) → Inno Source sees it in the portal under
  «📥 طلبات الموقع» (rate-limited, honeypot field `website`).
- Screenshots in `assets/shots/*.webp` come from the real app (`apps/pos/tools/videos/promo-assets`);
  re-export them when the screens change. Contact numbers are the same as `apps/pos/src/lib/vendor.js`.
- No build step and no external scripts or fonts. Edit `index.html` / `style.css` / `app.js` and push;
  on inno run `sudo bash /opt/innoforge/apps/license-server/deploy/install-inno.sh` to pull it.
