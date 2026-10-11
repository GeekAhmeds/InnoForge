#!/usr/bin/env node
'use strict';
// Records the tutorial videos by driving the real app (Playwright + Electron), with Arabic
// captions, a visible cursor and title cards drawn on top of the window, then converts
// them to MP4 with ffmpeg. Needs: npm run build first, ffmpeg on PATH, and on Linux a
// display (xvfb-run). Each video also gets <id>.captions.json (for the Egyptian voice-over,
// tools/videos/voiceover.py) and <id>.srt subtitles. Usage:
//   xvfb-run -a node tools/videos/record.cjs [outDir] [only-this-video-id]
// The GitHub workflow "POS videos" runs all of it (recording + voice-over) in one click.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright'); }
const { _electron } = playwright;

const APP = path.join(__dirname, '..', '..');
const ELECTRON = require(path.join(APP, 'node_modules', 'electron'));
const OUT = path.resolve(process.argv[2] || path.join(APP, 'release', 'videos'));
const ONLY = process.argv[3] || null;
const SIZE = { width: 1280, height: 800 };
const PIN = '1234';

const OVERLAY_CSS = `
#__cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:78%;background:rgba(15,23,42,.9);color:#fff;
  font:700 22px/1.5 Tahoma,"Segoe UI",sans-serif;padding:12px 24px;border-radius:14px;z-index:2147483600;text-align:center;direction:rtl;
  transition:opacity .35s;box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none}
#__cur{position:fixed;width:24px;height:24px;border-radius:50%;background:rgba(247,165,49,.9);border:3px solid #fff;
  box-shadow:0 0 0 2px rgba(0,0,0,.25);z-index:2147483601;pointer-events:none;transition:left .5s ease,top .5s ease;left:50%;top:60%;transform:translate(-50%,-50%)}
#__cur.click{animation:__pulse .45s}
@keyframes __pulse{0%{box-shadow:0 0 0 0 rgba(247,165,49,.95)}100%{box-shadow:0 0 0 26px rgba(247,165,49,0)}}
#__card{position:fixed;inset:0;z-index:2147483602;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  background:linear-gradient(160deg,#0a43c9,#0890c4);color:#fff;font-family:Tahoma,"Segoe UI",sans-serif;text-align:center;direction:rtl;transition:opacity .5s;pointer-events:none}
#__card h1{font-size:50px;margin:0} #__card p{font-size:26px;margin:0;opacity:.95} #__card small{font-size:18px;opacity:.8}
#__card .band{width:140px;height:6px;border-radius:3px;background:linear-gradient(90deg,#fff,#f7a531)}`;

// Spoken form of a caption for the Egyptian voice-over (tools/videos/voiceover.py).
function speakable(text) {
  return String(text || '')
    .replace(/InnoForge POS/g, 'إنوفورج بي أو إس').replace(/InnoForge/g, 'إنوفورج').replace(/Inno Source/g, 'إنو سورس')
    .replace(/innovationsrc\.com/g, 'إنوفيشن سورس دوت كوم')
    .replace(/\bF(\d)\b/g, (_, n) => `إف ${['صفر', 'واحد', 'اتنين', 'تلاتة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة'][n]}`)
    .replace(/Excel/gi, 'إكسيل').replace(/PDF/g, 'بي دي إف').replace(/\bA4\b/g, 'إيه فور')
    .replace(/[«»✓]/g, '').replace(/[—•]/g, '، ').replace(/←/g, ' وبعدين ').replace(/\s+/g, ' ').trim();
}
// Rough Egyptian speech length, so captions stay up long enough to be spoken.
const speechMs = (say) => (say ? 700 + say.length * 75 : 0);

function director(w, t0 = Date.now()) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timeline = [];
  const mark = (text, say) => timeline.push({ start: Math.max(0, (Date.now() - t0) / 1000), text, say: say ?? speakable(text) });
  const ensure = () => w.evaluate((css) => {
    if (document.getElementById('__cap')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__cap'; c.style.opacity = '0'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = '__cur'; document.body.appendChild(k);
  }, OVERLAY_CSS);
  const d = {
    sleep,
    timeline,
    /** Shows a caption; `ms` = how long to hold before going on (0 = continue while it shows). */
    async cap(text, ms = 1800, say = undefined) {
      await ensure();
      await w.evaluate((t) => { const c = document.getElementById('__cap'); c.textContent = t; c.style.opacity = t ? '1' : '0'; }, text || '');
      if (text) mark(text, say);
      const hold = Math.max(ms, ms ? speechMs(say ?? speakable(text)) : 0);
      if (hold) await sleep(hold);
    },
    async card(title, sub = '', small = '', ms = 2600) {
      await ensure();
      const say = speakable([title, sub].filter(Boolean).join('. '));
      mark([title, sub].filter(Boolean).join(' — '), say);
      ms = Math.max(ms, speechMs(say) + 400);
      await w.evaluate(([t, s, m]) => {
        let c = document.getElementById('__card');
        if (!c) { c = document.createElement('div'); c.id = '__card'; document.body.appendChild(c); }
        c.innerHTML = `<h1></h1><div class="band"></div><p></p><small></small>`;
        c.querySelector('h1').textContent = t; c.querySelector('p').textContent = s; c.querySelector('small').textContent = m;
        c.style.opacity = '1';
      }, [title, sub, small]);
      await sleep(ms);
      await w.evaluate(() => { const c = document.getElementById('__card'); if (c) c.style.opacity = '0'; });
      await sleep(500);
      await w.evaluate(() => document.getElementById('__card')?.remove());
    },
    async point(sel) {
      await ensure();
      const el = w.locator(sel).first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const b = await el.boundingBox();
      if (b) await w.evaluate(([x, y]) => { const k = document.getElementById('__cur'); k.style.left = `${x}px`; k.style.top = `${y}px`; }, [b.x + b.width / 2, b.y + b.height / 2]);
      await sleep(600);
    },
    async click(sel, pause = 700) {
      await d.point(sel);
      await w.evaluate(() => { const k = document.getElementById('__cur'); k.classList.remove('click'); void k.offsetWidth; k.classList.add('click'); });
      await w.locator(sel).first().click();
      await sleep(pause);
    },
    async type(sel, text, pause = 400) {
      await d.point(sel);
      const el = w.locator(sel).first();
      await el.click();
      await el.fill('');
      await el.pressSequentially(String(text), { delay: 70 });
      await sleep(pause);
    },
    async key(k, pause = 600) { await w.keyboard.press(k); await sleep(pause); },
  };
  return d;
}

async function launch(dataDir, { record = true, edition = null } = {}) {
  const t0 = Date.now();
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [APP, '--no-sandbox'],
    env: { ...process.env, INNOFORGE_POS_DATA_DIR: dataDir, ...(edition ? { INNOFORGE_POS_EDITION: edition } : {}) },
    ...(record ? { recordVideo: { dir: path.join(dataDir, 'rec'), size: SIZE } } : {}),
  });
  const w = await app.firstWindow();
  await w.setViewportSize(SIZE);
  await app.evaluate(({ ipcMain, dialog }) => {
    ipcMain.removeHandler('pos:print');
    ipcMain.handle('pos:print', () => ({ ok: true, data: { success: true } }));
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  const call = (ns, m, a) => w.evaluate(([n, mm, aa]) => window.posBridge.call(n, mm, aa), [ns, m, a]).then((r) => { if (!r.ok) throw new Error(`${ns}.${m}: ${r.code}`); return r.data; });
  return { app, w, call, t0 };
}

async function setup(w, { type = null, name = 'ماركت النور', cash = '500' } = {}) {
  await w.waitForSelector('.setup');
  if (type) await w.click(`.type-card:has-text("${type}")`);
  const inputs = w.locator('.setup input');
  await inputs.nth(0).fill(name); await inputs.nth(2).fill('أحمد'); await inputs.nth(4).fill(PIN);
  await w.click('.setup button.primary');
  if (cash != null) {
    await w.waitForSelector('.center-screen.inner form');
    await w.fill('.center-screen.inner input', cash); await w.click('.center-screen.inner button.primary');
  }
  await w.waitForSelector('.sidebar nav');
}

async function login(w, d) {
  await w.waitForSelector('.user-tile');
  await d.click('.user-tile');
  for (const k of PIN) await d.click(`.numpad button:text-is("${k}")`, 150);
  await d.click('.numpad button.primary', 900);
  await w.waitForSelector('.sidebar nav');
}

/** Prepares a data folder (no recording), then records `scene` in a fresh launch. */
async function make(id, { prep, scene, edition = null }) {
  if (ONLY && ONLY !== id) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pos-video-${id}-`));
  if (prep) {
    const p = await launch(dir, { record: false, edition });
    await prep(p);
    await p.app.close();
  }
  const r = await launch(dir, { edition });
  const d = director(r.w, r.t0);
  try {
    await scene({ ...r, d });
    await d.sleep(800);
  } finally {
    const video = r.w.video();
    await r.app.close();
    const webm = await video.path();
    const mp4 = path.join(OUT, `${id}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    writeCaptions(path.join(OUT, id), d.timeline);
    console.log(`✓ ${mp4} (${Math.round(fs.statSync(mp4).size / 1024)} KB)`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** <id>.captions.json (for the voice-over) and <id>.srt (subtitles for YouTube/players). */
function writeCaptions(base, timeline) {
  fs.writeFileSync(`${base}.captions.json`, JSON.stringify({ events: timeline }, null, 2));
  const ts = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor(ms / 60000) % 60; const s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  fs.writeFileSync(`${base}.srt`, timeline.map((e, i) => `${i + 1}\n${ts(e.start)} --> ${ts(timeline[i + 1]?.start ?? e.start + 4)}\n${e.text}\n`).join('\n'));
}

const nav = (d, text) => d.click(`.sidebar nav button:has-text("${text}")`, 1000);

const VIDEOS = {
  '01-first-sale': {
    scene: async ({ w, d }) => {
      await d.card('InnoForge POS', 'أول تشغيل وأول بيعة', 'دليل بالفيديو — Inno Source');
      await w.waitForSelector('.setup');
      await d.cap('أول مرة: اختار نوع النشاط');
      await d.click('.type-card:has-text("محل")');
      await d.cap('اكتب اسم النشاط', 0);
      await d.type('.setup input >> nth=0', 'ماركت النور');
      await d.cap('وبيانات المدير والرقم السري', 0);
      await d.type('.setup input >> nth=2', 'أحمد');
      await d.type('.setup input >> nth=4', PIN);
      await d.click('.setup button.primary', 1200);
      await d.cap('افتح الوردية بالكاش اللي في الدرج');
      await d.type('.center-screen.inner input', '500');
      await d.click('.center-screen.inner button.primary', 1500);
      await d.cap('دوس على الأصناف أو امسح الباركود');
      for (const p of ['شيبسي', 'مياه', 'شوكولاتة']) await d.click(`.product:has-text("${p}") >> nth=0`, 500);
      await d.click('.product:has-text("شيبسي") >> nth=0', 600);
      await d.cap('الإجمالي بيتحسب لوحده — اضغط «دفع» أو F9', 1600);
      await d.click('button.pay', 900);
      await d.cap('اكتب المبلغ اللي العميل دفعه — والباقي بيظهر', 0);
      await d.type('.modal input.xl', '100', 900);
      await w.locator('.modal-foot .toggle input').uncheck();
      await d.click('.modal-foot button.primary', 1500);
      await d.cap('تم البيع ✓ والباقي للعميل ظاهر — والفاتورة اتطبعت', 2600);
      await d.card('سهل وسريع', 'بيع بالباركود • كاش وفيزا وآجل • يشتغل من غير نت', 'InnoForge POS — innovationsrc.com');
    },
  },
  '02-credit-collect': {
    prep: async ({ w, call }) => {
      await setup(w);
      await call('customers', 'save', { name: 'حسن محمود', phone: '01001234567', credit_limit: 500000 });
      await call('auth', 'logout');
    },
    scene: async ({ w, d }) => {
      await d.card('البيع الآجل والتحصيل', 'سند قبض بكل تحصيل', 'InnoForge POS');
      await login(w, d);
      await d.cap('اختار العميل (F4)');
      await d.click('.product:has-text("صابون") >> nth=0', 400);
      await d.click('.product:has-text("مناديل") >> nth=0', 400);
      await d.key('F4', 900);
      await d.type('.modal input >> nth=0', 'حسن', 900);
      await d.click('.modal .customer-results button >> nth=0', 900);
      await d.click('.modal-foot button.primary', 900);
      await d.cap('ادفع جزء والباقي على حسابه');
      await d.click('button.pay', 900);
      await d.type('.modal input.xl', '20', 600);
      await w.locator('.modal-foot .toggle input').uncheck();
      await d.click('.modal-foot button.primary', 1500);
      await d.cap('من «العملاء» افتح العميل — رصيده وكشف حسابه');
      await nav(d, 'العملاء');
      await d.click('table.grid tbody tr:has-text("حسن")', 1500);
      await d.cap('«تحصيل»: الطريقة والمبلغ والفواتير اللي بيسددها');
      await d.click('.modal button:has-text("تحصيل من العميل")', 1200);
      await d.click('button:has-text("حفظ سند القبض")', 1800);
      await d.cap('سند قبض مرقّم بيتطبع، والرصيد بيتحدث ✓', 2500);
      await d.card('حسابات العملاء مظبوطة', 'آجل • تحصيل • شيكات • أعمار ديون • تذكير واتساب', 'InnoForge POS');
    },
  },
  '03-products-purchase': {
    prep: async ({ w, call }) => {
      await setup(w);
      await call('suppliers', 'save', { name: 'شركة النيل للتوزيع' });
      await call('auth', 'logout');
    },
    scene: async ({ w, d }) => {
      await d.card('الأصناف والمشتريات', 'صنف جديد وفاتورة شراء', 'InnoForge POS');
      await login(w, d);
      await nav(d, 'الأصناف');
      await d.cap('«صنف جديد»: الاسم والسعر والتكلفة');
      await d.click('button:has-text("صنف جديد")', 900);
      await d.type('.modal label:has-text("الاسم") input', 'زيت عباد الشمس 1 لتر');
      await d.type('.modal label:has-text("سعر البيع") input', '95');
      await d.type('.modal label:has-text("التكلفة") input', '80');
      await d.click('.modal-foot button.primary', 1200);
      await d.cap('فاتورة شراء: المورد والأصناف والكمية');
      await nav(d, 'المشتريات');
      await d.click('button:has-text("فاتورة شراء")', 1000);
      await w.locator('.modal select >> nth=0').selectOption({ index: 1 });
      await d.sleep(600);
      await d.type('.modal input[placeholder*="ابحث"], .modal input[placeholder*="باركود"] >> nth=0', 'زيت', 900);
      await d.click('.modal .search-results button, .modal .dropdown button >> nth=0', 900);
      await d.type('.modal table tbody tr input[inputmode="decimal"] >> nth=0', '24', 800);
      await d.cap('الرصيد والتكلفة بيتحدثوا لوحدهم مع الحفظ');
      await d.click('.modal-foot button.primary', 1800);
      await d.card('مخزون مظبوط', 'وحدات • قوائم أسعار • جرد بالباركود • صلاحية • أوامر شراء', 'InnoForge POS');
    },
  },
  '04-restaurant': {
    edition: 'restaurant',
    prep: async ({ w, call }) => { await setup(w, { type: 'مطعم', name: 'مطعم الفرح', cash: null }); await call('shifts', 'open', { openingCash: 30000 }); await call('auth', 'logout'); },
    scene: async ({ w, d }) => {
      await d.card('المطاعم والكافيهات', 'طاولة ← مطبخ ← حساب', 'InnoForge POS');
      await login(w, d);
      await d.cap('شاشة الصالة: كل الطاولات وحالتها');
      await d.click('.sidebar nav button:has-text("الصالة")', 1200);
      await d.click('.floor-table >> nth=2', 1000);
      if (await w.locator('.modal input').count()) { await d.type('.modal input', '3'); await d.click('.modal-foot button.primary', 900); }
      await d.cap('ضيف الطلب للطاولة');
      const tiles = w.locator('.product');
      for (let i = 0; i < 3; i++) await d.click(`.product >> nth=${i}`, 450);
      if (await tiles.count()) await d.click('.product >> nth=0', 450);
      await d.cap('«إرسال للمطبخ»: تذكرة لكل قسم وشاشة للشيف');
      await d.click('button:has-text("للمطبخ") >> nth=0', 1500);
      await d.cap('الطاولة بقت مشغولة: المبلغ والوقت ظاهرين', 0);
      await d.point('.floor-table >> nth=2');
      await d.sleep(2200);
      await d.cap('ولما الزبون يخلّص: افتح الطاولة ← الحساب ← الدفع', 2600);
      await d.card('كل اللي المطعم محتاجه', 'صالة • مطبخ • أحجام وإضافات • ريسيبي • دليفري • شاشة مطبخ على تابلت', 'InnoForge POS');
    },
  },
  '05-installments': {
    edition: 'full',
    prep: async ({ w, call }) => {
      await setup(w, { type: 'شركة تجارية', name: 'النور للأجهزة' });
      await call('products', 'save', { name: 'ثلاجة توشيبا 16 قدم', price: 2400000, cost: 1900000, stock: 10 });
      await call('customers', 'save', { name: 'حسن محمود', phone: '01001234567', credit_limit: 10000000 });
      await call('auth', 'logout');
    },
    scene: async ({ w, d }) => {
      await d.card('البيع بالتقسيط', 'مقدم + أقساط شهرية بجدول', 'InnoForge POS');
      await login(w, d);
      await d.cap('فاتورة بيع: اختار العميل');
      await d.click('.sidebar nav button:has-text("فاتورة بيع")', 1000);
      await d.type('.search-add input', 'حسن', 900);
      await d.click('.search-add .dropdown button', 900);
      await d.cap('ضيف الصنف');
      await d.type('.add-row input', 'ثلاجة', 700);
      await d.key('Enter', 900);
      await d.cap('اكتب المقدم، وفعّل «بيع بالتقسيط»');
      await d.type('.inv-pay label:has-text("المدفوع") input', '4000', 600);
      await d.click('.inv-pay label.toggle:has-text("بيع بالتقسيط")', 900);
      await d.type('.inst-fields label:has-text("عدد الأقساط") input', '10', 1200);
      await d.click('button:has-text("حفظ الفاتورة")', 1800);
      await d.cap('«العملاء ← الأقساط»: المتأخر والمستحق وتذكير واتساب');
      await nav(d, 'العملاء');
      await d.click('.page-head .seg button:has-text("الأقساط")', 1200);
      await d.click('table.grid tr.clickable', 1500);
      await d.cap('جدول الأقساط — طباعة وتحصيل القسط', 2500);
      await d.card('تقسيط من غير ورق', 'جدول مطبوع • تذكير • تحصيل • متأخرات في التقارير', 'InnoForge POS');
    },
  },
  '06-employees': {
    edition: 'full',
    prep: async ({ w, call }) => {
      await setup(w);
      await call('employees', 'save', { name: 'محمد علي', job: 'كاشير', salary: 600000 });
      await call('employees', 'save', { name: 'سعد إبراهيم', job: 'مخزن', pay_type: 'daily', salary: 25000 });
      const m = new Date().toLocaleDateString('en-CA').slice(0, 7);
      for (const dd of ['01', '02', '03', '04']) await call('employees', 'setDay', { employeeId: 2, day: `${m}-${dd}`, status: 'present', checkIn: '09:00', checkOut: '17:00' });
      await call('employees', 'setDay', { employeeId: 1, day: `${m}-02`, status: 'absent' });
      await call('auth', 'logout');
    },
    scene: async ({ w, d }) => {
      await d.card('الموظفين والمرتبات', 'حضور • سلف • مرتبات', 'InnoForge POS');
      await login(w, d);
      await nav(d, 'الموظفين');
      await d.cap('كل موظف يدوس على اسمه وهو جاي وهو ماشي');
      await d.click('.punch-card:has-text("محمد")', 1400);
      await d.cap('جدول الحضور والغياب للشهر');
      await d.click('.page-head .seg button:has-text("الحضور والغياب")', 1800);
      await d.cap('السلفة بتطلع من الدرج وبتتخصم من المرتب');
      await d.click('.page-head .seg button:has-text("السلف والمكافآت")', 900);
      await d.click('button:has-text("+ سلفة")', 900);
      await d.type('.modal input[inputmode="decimal"]', '500', 700);
      await d.click('.modal-foot button.primary', 1200);
      await d.cap('كشف المرتبات: الأساسي − الغياب + المكافآت − السلف');
      await d.click('.page-head .seg button:has-text("المرتبات")', 2200);
      await d.card('شئون العاملين في نفس البرنامج', 'حضور وانصراف • غياب • سلف • مكافآت • كشف مرتبات', 'InnoForge POS');
    },
  },
  '07-reports': {
    prep: async ({ w, call }) => {
      await setup(w);
      const prods = await call('products', 'list', {});
      for (let i = 0; i < 18; i++) {
        const items = [prods[i % prods.length], prods[(i * 3 + 1) % prods.length]].map((p, k) => ({ product_id: p.id, qty: 1 + ((i + k) % 3) }));
        await call('orders', 'checkout', { items, payments: [{ method: 'cash', amount: 999999 }] });
      }
      await call('expenses', 'create', { category: 'كهرباء', amount: 35000, fromDrawer: true });
      await call('auth', 'logout');
    },
    scene: async ({ w, d }) => {
      await d.card('التقارير', 'أكتر من 30 تقرير • إكسيل • PDF', 'InnoForge POS');
      await login(w, d);
      await d.cap('لوحة التحكم: اليوم في ثانية');
      await nav(d, 'لوحة التحكم');
      await d.sleep(1500);
      await d.cap('التقارير: اختار الفترة والتقرير');
      await nav(d, 'التقارير');
      await d.sleep(1200);
      await d.click('.report-nav button:has-text("مبيعات وأرباح الأصناف")', 1500);
      await d.cap('رتّب بأي عمود');
      await d.click('.report-table th:has-text("الربح")', 1200);
      await d.cap('الأرباح والخسائر');
      await d.click('.report-nav button:has-text("الأرباح والخسائر")', 2000);
      await d.cap('وكل تقرير: Excel منسّق • PDF • طباعة');
      await d.point('.report-head button:has-text("Excel")');
      await d.sleep(1500);
      await d.card('قرارات أسرع', 'مبيعات • أرباح • مخزون • عملاء • موردين • خزنة • موظفين', 'InnoForge POS');
    },
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [id, v] of Object.entries(VIDEOS)) {
    try {
      await make(id, v);
    } catch (err) {
      console.error(`✗ ${id}: ${err.message.split('\n')[0]}`);
    }
  }
})();
