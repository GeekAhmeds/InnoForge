---
name: pos-e2e-test
description: Verify InnoForge POS screens end to end by driving the real Electron app with Playwright (_electron) under xvfb, with a throwaway data folder, mocked printing and screenshots. Use after UI changes to prove a flow works.
---

# End-to-end checks of the POS app

The app runs from source (`apps/pos`, after `npx vite build`) with a temporary data folder, so every run starts at the setup screen. Keep test scripts **outside the repo** (e.g. the scratchpad).

## Template
```js
const { _electron } = require('playwright');          // or the global install path
const fs = require('fs');
const DATA = '/tmp/pos-e2e/data'; fs.rmSync(DATA, { recursive: true, force: true });
(async () => {
  const app = await _electron.launch({
    executablePath: require('path').join(APP, 'node_modules/electron/dist/electron'),
    args: [APP, '--no-sandbox'], env: { ...process.env, INNOFORGE_POS_DATA_DIR: DATA },
  });
  const w = await app.firstWindow(); await w.setViewportSize({ width: 1366, height: 860 });
  const errors = []; w.on('pageerror', (e) => errors.push(e.message)); w.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Capture prints instead of printing.
  await app.evaluate(({ ipcMain }) => {
    global.__prints = []; ipcMain.removeHandler('pos:print');
    ipcMain.handle('pos:print', (_e, job) => { global.__prints.push(job); return { ok: true, data: { success: true } }; });
  });
  // Setup: pick a business type card, fill name / admin / PIN.
  await w.waitForSelector('.setup');
  await w.click('.type-card:has-text("مطعم")');           // optional
  const i = w.locator('.setup input'); await i.nth(0).fill('Shop'); await i.nth(2).fill('Admin'); await i.nth(4).fill('1234');
  await w.click('.setup button.primary');
  // Open a shift (cashier screen).
  await w.waitForSelector('.center-screen.inner form'); await w.fill('.center-screen.inner input', '0'); await w.click('.center-screen.inner button.primary');
  // ... drive the flow, w.screenshot({ path }) at each step ...
  console.log('errors:', JSON.stringify(errors)); await app.close();
})();
```
Run: `xvfb-run -a node my-check.cjs`.

## Tips
- Sidebar: `.sidebar nav button:has-text("…")`; tabs: `.page-head .seg button:has-text("…")`; dialogs: `.modal`, `.modal-foot button.primary`.
- The in-app question dialog (`ask`) is a `.modal` with one input — fill it and click `.modal-foot button.primary`.
- Call services directly when setting up data is easier: `await w.evaluate(() => window.posBridge.call('products', 'list', {}))` → `{ ok, data }`.
- Mock external links: `app.evaluate(({ shell }) => { shell.openExternal = async (u) => { global.__urls = [u]; }; })`; mock save dialogs the same way through `dialog.showSaveDialog`.
- Other windows (kitchen screen): `app.windows().find((x) => x.url().includes('/kds'))`.
- Pressing F9 right after adding items can race the price calculation — wait ~500 ms or for the total to update.
- Look at the screenshots: Arabic layout bugs (RTL, wrapping, untranslated `key.names`) only show there.
