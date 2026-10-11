#!/usr/bin/env node
'use strict';
// Records the marketing video from promo.html (1280×720) with Chromium and converts it to MP4.
// Usage: node tools/videos/promo.cjs <assetsDir with the screenshots + logo.png> [out.mp4]
// The assets folder needs: logo.png cashier.png floor.png kds.png invoice.png installments.png
// warehouses.png reports.png payroll.png display.png (screenshots of the app, any size).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright'); }

const assets = path.resolve(process.argv[2] || 'assets');
const out = path.resolve(process.argv[3] || path.join(__dirname, '..', '..', 'release', 'videos', '00-promo.mp4'));

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-promo-'));
  fs.copyFileSync(path.join(__dirname, 'promo.html'), path.join(work, 'promo.html'));
  fs.cpSync(assets, path.join(work, 'assets'), { recursive: true });
  const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: work, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto(`file://${path.join(work, 'promo.html')}`);
  await page.waitForFunction(() => window.PROMO_DONE === true, null, { timeout: 120000, polling: 500 });
  // Slide start times (minus the 0.4 s trimmed below) for the voice-over.
  const events = (await page.evaluate(() => window.PROMO_CAPTIONS)).map((e) => ({ ...e, start: Math.max(0, e.start - 0.4 + 0.3) }));
  await page.waitForTimeout(400);
  const video = page.video();
  await ctx.close();
  await browser.close();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Drop the first moments (blank page while loading) and encode for the web.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.4', '-i', await video.path(), '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  fs.writeFileSync(out.replace(/\.mp4$/, '.captions.json'), JSON.stringify({ events }, null, 2));
  console.log(`✓ ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  fs.rmSync(work, { recursive: true, force: true });
})().catch((err) => { console.error(err); process.exit(1); });
