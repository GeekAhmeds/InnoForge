// InnoForge POS website: screenshot tabs, live download links from the update server,
// WhatsApp activation link, and the contact form (saved in the license server: /api/v1/lead).
(() => {
  const $ = (id) => document.getElementById(id);
  const PHONE = '201011600023';
  $('year').textContent = new Date().getFullYear();

  // ---- screenshots ----
  const SHOTS = [
    ['cashier', 'الكاشير', 'شاشة الكاشير: باركود، أصناف بالضغط، كوبونات، وتعليق الفاتورة.'],
    ['dashboard', 'لوحة التحكم', 'ملخص اليوم لصاحب المحل والتنبيهات.'],
    ['floor', 'المطعم', 'صالة المطعم: الطاولات المشغولة والفاضية وحساب كل طاولة.'],
    ['kds', 'شاشة المطبخ', 'شاشة المطبخ: الطلبات أول بأول لكل قسم.'],
    ['invoice', 'الفاتورة التجارية', 'فاتورة البيع التجارية A4 للشركات.'],
    ['installments', 'التقسيط', 'جدول الأقساط والمتأخر والتحصيل.'],
    ['warehouses', 'المخازن', 'أكتر من مخزن والتحويل بينهم.'],
    ['reports', 'التقارير', 'أكتر من 30 تقرير بتتصدّر إكسيل وPDF.'],
    ['payroll', 'المرتبات', 'الموظفين والحضور والمرتبات.'],
    ['eta', 'الفاتورة الإلكترونية', 'حالة كل مستند اتبعت لمنظومة الضرائب.'],
    ['network', 'الفروع والأجهزة', 'الجهاز الرئيسي والأجهزة المتصلة بيه.'],
    ['display', 'شاشة العميل', 'شاشة تانية قدام العميل بتعرض الفاتورة.'],
  ];
  const tabs = $('shotTabs');
  const show = (i) => {
    const [id, , cap] = SHOTS[i];
    $('shotImg').src = `/site/assets/shots/${id}.webp`;
    $('shotImg').alt = cap;
    $('shotCap').textContent = cap;
    [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j));
  };
  SHOTS.forEach(([, label], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => show(i);
    tabs.appendChild(b);
  });
  show(0);
  const lb = $('lightbox');
  $('shotImg').onclick = () => { lb.querySelector('img').src = $('shotImg').src; lb.hidden = false; };
  lb.onclick = () => { lb.hidden = true; };
  document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('nav-open')));

  // ---- downloads: read the current version from the update files ----
  const yml = async (name) => {
    const r = await fetch(`/updates/${name}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const text = await r.text();
    const get = (k) => (text.match(new RegExp(`^${k}:\\s*['"]?([^'"\\n]+)`, 'm')) || [])[1];
    return { version: get('version'), path: get('path'), date: get('releaseDate') };
  };
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
  yml('latest.yml').then((w) => {
    $('dlWin').href = `/updates/${encodeURIComponent(w.path)}`;
    $('verWin').textContent = `النسخة ${w.version}${w.date ? ` — ${fmtDate(w.date)}` : ''}`;
  }).catch(() => { $('verWin').textContent = 'هتلاقي الملف في صفحة التحديثات'; });
  yml('latest-linux.yml').then((l) => {
    $('dlAppImage').href = `/updates/${encodeURIComponent(l.path)}`;
    $('dlDeb').href = `/updates/${encodeURIComponent(l.path.replace(/-x86_64\.AppImage$/, '-amd64.deb'))}`;
    $('verLinux').textContent = `النسخة ${l.version}`;
  }).catch(() => { $('verLinux').textContent = ''; });

  // ---- WhatsApp activation ----
  const msg = 'السلام عليكم، عايز أفعّل InnoForge POS.\nاسم النشاط: \nالباقة: \nرقم الجهاز: ';
  $('waActivate').href = `https://wa.me/${PHONE}?text=${encodeURIComponent(msg)}`;

  // ---- contact form ----
  const form = $('leadForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('formMsg');
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button');
    btn.disabled = true;
    out.className = 'form-msg';
    out.textContent = 'بيتبعت…';
    try {
      const r = await fetch('/api/v1/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.status);
      out.className = 'form-msg ok';
      out.textContent = '✓ وصلتنا رسالتك، هنكلمك قريب. شكرًا!';
      form.reset();
    } catch (err) {
      out.className = 'form-msg err';
      out.innerHTML = `ماتبعتتش (${String(err.message || err)}). كلّمنا على <a href="https://wa.me/${PHONE}" target="_blank" rel="noopener">الواتساب</a> أو 01011600023.`;
    } finally {
      btn.disabled = false;
    }
  });
})();
