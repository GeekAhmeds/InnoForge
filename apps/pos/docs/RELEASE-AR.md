# تنزيل نسخة جديدة من البرنامج للعملاء — وحل المشاكل

> الملف ده مرجعك لو حبيت تنزّل نسخة، أو لو حصلت أي مشكلة في التحديثات.
> آخر تحديث: 16 أكتوبر 2026.

---

## 1. الفكرة في سطرين

- كل تعديل بيترفع على GitHub، الـ CI بيبني منه نسخة اسمها `pos-v0.1.XX` (ويندوز + لينكس، وموقّعة).
  النسخة دي بتبقى **pre-release**، يعني موجودة على GitHub بس **مش بتوصل للعملاء** لوحدها.
- السيرفر `inno` هو اللي بيوزّع التحديثات على `https://pos.0x01source.com:9990/updates/`.
  البرنامج عند العميل بيشيّك على العنوان ده ويحدّث نفسه.

يعني «تنزيل نسخة للعملاء» = إنك تخلّي السيرفر ياخد النسخة دي.

---

## 2. تنزّل نسخة للعملاء (الطريقة الأساسية — من السيرفر)

ادخل على `inno` وشغّل (غيّر الرقم لرقم النسخة اللي عاوزها):

```bash
sudo TAG=pos-v0.1.56 innoforge-updates-sync
```

واتأكد إنها نزلت:

```bash
curl -s https://pos.0x01source.com:9990/updates/latest.yml | head -1
```

لازم يطلع `version: 0.1.56`. خلاص كده — العملاء بيتحدّثوا لوحدهم أول ما يفتحوا البرنامج وهو متصل بالنت
(أو من «الإعدادات ← الدعم الفني ← البحث عن تحديث»).

**تعرف رقم آخر نسخة منين؟** من `https://github.com/GeekAhmeds/InnoForge/releases` — دوّر على أعلى رقم يبدأ بـ `pos-v`
(تجاهل أي حاجة تبدأ بـ `azim-v`، دي برنامج تاني).

---

## 3. الطريقة التانية — من موقع GitHub (لو مش عاوز تدخل السيرفر)

1. افتح `https://github.com/GeekAhmeds/InnoForge/releases`
2. دوس على اسم النسخة، مثلاً `pos-v0.1.56`.
3. فوق على اليمين أيقونة قلم ✏️ (Edit) — دوس عليها.
4. انزل لآخر الصفحة: هتلاقي مربع عليه ✓ جنب **Set as a pre-release** — **شيل العلامة**.
5. لو ظهر مربع **Set as the latest release** — **سيبه فاضي** (العلامة دي بتاعة azim).
6. دوس الزرار الأخضر **Update release**.

السيرفر بيشيّك كل 10 دقايق، وهياخد أعلى نسخة `pos-v…` مش pre-release.

---

## 4. ليه مش بنستخدم «Latest» على GitHub؟

GitHub بيسمح بنسخة «Latest» **واحدة بس** في الـ repo كله. برنامج **azim** بينزّل نسخه في نفس الـ repo
وبياخد العلامة دي. السكريبت القديم على السيرفر كان بيدوّر على «Latest»، فلما لقاها azim وقف ومنزّلش نسخ POS.

اتصلّح (16 أكتوبر): السكريبت دلوقتي:
- بياخد أعلى نسخة اسمها `pos-v…` ومش pre-release — ومش بيبص على «Latest» خالص.
- **مبيرجعش لنسخة أقدم من اللي على السيرفر أبداً** — فاللي بتنزّله بإيدك بأمر `TAG=` بيفضل زي ما هو.
- الأمر اليدوي `TAG=` بينزّل أي نسخة (حتى pre-release أو أقدم) — ودي طريقة الرجوع لنسخة قديمة لو نسخة طلع فيها مشكلة.

> لو في يوم فصلت azim في repo لوحده، مش هتفرق — الطريقتين فوق هيفضلوا شغالين.

---

## 5. تحديث السكريبت على السيرفر (مرة واحدة بعد أي تعديل فيه)

السكريبت نفسه متسطّب في `/usr/local/bin/innoforge-updates-sync`، ونسخته الأصلية في المشروع
`apps/license-server/deploy/updates-sync.sh`. لو اتعدّل في المشروع، حدّثه على inno كده:

```bash
sudo git -C /opt/innoforge pull
sudo install -m 755 /opt/innoforge/apps/license-server/deploy/updates-sync.sh /usr/local/bin/innoforge-updates-sync
sudo systemctl start innoforge-updates.service
journalctl -u innoforge-updates -n 5 --no-pager
```

لو `/opt/innoforge` مش نسخة git (الأمر الأول قال `not a git repository`)، نزّل الملف مباشرة:

```bash
curl -fsSL https://raw.githubusercontent.com/GeekAhmeds/InnoForge/claude/amazing-noether-jd4woa/apps/license-server/deploy/updates-sync.sh -o /tmp/updates-sync.sh
bash -n /tmp/updates-sync.sh && sudo install -m 755 /tmp/updates-sync.sh /usr/local/bin/innoforge-updates-sync
```

(الطريقة دي شغالة طول ما الـ repo عام. لو بقى Private، استخدم الطريقة الأولى.)

ده **مبيلمسش** nginx ولا المواقع ولا البورتات التانية — بيبدّل ملف السكريبت بس.

---

## 6. حل المشاكل

### أوامر الفحص السريع (ابدأ بيهم دايماً)

```bash
curl -s https://pos.0x01source.com:9990/updates/latest.yml | head -1   # النسخة اللي العملاء شايفينها
cat /srv/InnoForge/PoS/.release                                        # آخر نسخة السيرفر نزّلها
ls -la /srv/InnoForge/PoS                                              # الملفات نفسها
journalctl -u innoforge-updates -n 30 --no-pager                       # لوج السحب
systemctl list-timers | grep innoforge                                 # التايمر شغال؟ وامتى المرة الجاية
```

### الجدول

| اللي بيحصل | السبب | الحل |
|---|---|---|
| النسخة الجديدة مش بتنزل لوحدها | لسه pre-release | نزّلها بالأمر في §2، أو شيل علامة pre-release (§3) |
| اللوج بيقول `is not a POS release — nothing to do` | السكريبت القديم (اللي بيدوّر على Latest) لسه على السيرفر | حدّثه (§5) |
| `release pos-v… not found` | رقم النسخة غلط أو لسه بتتبني | اتأكد من الرقم في صفحة Releases، واستنى الـ CI يخلص (حوالي 3 دقايق) |
| `GitHub not reachable` | النت على السيرفر، أو GitHub عامل حد للطلبات | جرّب تاني بعد شوية. لو اتكرر: حط `GITHUB_TOKEN=…` في `/etc/innoforge-updates.env` |
| `size mismatch` | التحميل اتقطع | شغّل الأمر تاني |
| `has no signature — refusing` | النسخة اتبنت من غير مفتاح التوقيع (سر `POS_SIGNING_KEY` في GitHub) | متنزّلهاش. راجع أسرار الـ repo وابني من جديد |
| `curl … latest.yml` مش بيرد | nginx أو البورت 9990 | `sudo nginx -t` و`sudo systemctl status nginx` — ومتغيّرش في ملفات المواقع التانية |
| العميل مش بيتحدّث والسيرفر عليه النسخة الجديدة | البرنامج بيشيّك وهو بيفتح بس، أو مفيش نت عنده | «الإعدادات ← الدعم الفني ← البحث عن تحديث»، أو يقفل البرنامج ويفتحه |
| نسخة نزلت وفيها مشكلة | — | ارجع للي قبلها فوراً: `sudo TAG=pos-v0.1.(الرقم القديم) innoforge-updates-sync` |

### الرجوع لنسخة أقدم (rollback)

```bash
sudo TAG=pos-v0.1.54 innoforge-updates-sync
curl -s https://pos.0x01source.com:9990/updates/latest.yml | head -1
```

السحب الأوتوماتيك مش هيرجّعها للنسخة الأحدث إلا لو في نسخة `pos-v…` **أعلى** متشال منها pre-release.
فلو النسخة اللي فيها المشكلة كنت شلت منها pre-release، رجّعلها العلامة على GitHub (§3 بالعكس).

---

## 7. أماكن الحاجات

| الحاجة | المكان |
|---|---|
| ملفات التحديث على السيرفر | `/srv/InnoForge/PoS` |
| السكريبت المتسطّب | `/usr/local/bin/innoforge-updates-sync` |
| التايمر (كل 10 دقايق) | `innoforge-updates.timer` / `innoforge-updates.service` |
| إعدادات اختيارية (توكن GitHub) | `/etc/innoforge-updates.env` |
| المشروع على السيرفر | `/opt/innoforge` |
| السكريبت في المشروع | `apps/license-server/deploy/updates-sync.sh` |
| بناء النسخ | `.github/workflows/pos-installer.yml` (على GitHub ← Actions) |
| شرح السيرفر كله | `apps/pos/docs/SERVER-SETUP-AR.md` |
