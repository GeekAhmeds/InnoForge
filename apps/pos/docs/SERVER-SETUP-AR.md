# تجهيز السيرفر عشان التحديثات تترفع لوحدها

الدليل ده بيوصّل GitHub بالسيرفر بتاعك `0x01source.com`. بعد ما تخلّصه، أي تعديل يتدمج في فرع `main` هيتبني ويتوقّع ويترفع على السيرفر لوحده، وكل نسخة متسطبة عند العملاء هتحدّث نفسها.

> امشي خطوة خطوة. وبعد كل خطوة فيها **✅ ابعتلي**، ابعتلي اللي ظهرلك قبل ما تكمّل.

---

## الصورة الكاملة: إيه اللي بيحصل؟

```
إنت (أو Claude) بيرفع تعديل على GitHub
        │
        ▼
GitHub Actions: بيشغّل الاختبارات ← بيبني نسخة ويندوز ولينكس ← بيوقّعها بمفتاحك الخاص
        │  (لو التعديل اتدمج في main)
        ▼
بيرفع ملفات التحديث بـ SSH على السيرفر في فولدر  /srv/InnoForge/PoS
        │
        ▼
السيرفر بيعرض الفولدر ده على  https://0x01source.com:7788/srv/InnoForge/PoS/
        │
        ▼
برنامج العميل بيسأل السيرفر كل 6 ساعات (وأول ما يفتح): في نسخة جديدة؟
  ← بينزّلها في الخلفية ← بيتأكد من توقيعك ← بياخد نسخة احتياطية ← بيتسطّب لما يعيد التشغيل
```

### إيه اللي بيترفع على السيرفر بالظبط؟

| الملف | يعني إيه |
|---|---|
| `latest.yml` | "كارت" النسخة الجديدة للويندوز: رقمها، واسم ملف التسطيب، وبصمته. البرنامج بيقراه الأول. |
| `InnoForge-POS-Setup-0.1.25.exe` | ملف تسطيب الويندوز نفسه (حوالي 100 ميجا). |
| `InnoForge-POS-Setup-0.1.25.exe.blockmap` | بيخلّي التحديث ينزّل الأجزاء اللي اتغيرت بس، مش الملف كله. |
| `InnoForge-POS-Setup-0.1.25.exe.sig` | **توقيعك.** من غيره البرنامج بيرفض التحديث، عشان كده محدش يقدر يرفعلك نسخة مزوّرة. |
| `latest-linux.yml` و `…AppImage` و `…AppImage.sig` | نفس الكلام لنسخة لينكس. |
| `….deb` | ملف تسطيب لينكس يدوي (مش بيتحدّث لوحده). |

**اللي عمره ما بيترفع:**
- كود البرنامج.
- مفتاحك الخاص `pos-license-private.pem`.
- بيانات العملاء أو مبيعاتهم.
- التراخيص.

السيرفر شايل ملفات التسطيب بس.

### رقم النسخة

- كل بناء بياخد رقم بالشكل `0.1.<رقم التشغيل>`، يعني `0.1.25` وبعدها `0.1.26`. فكل نسخة جديدة دايماً أكبر من القديمة، ومحتاجش تغيّر حاجة بإيدك.
- لو عاوز إصدار كبير (زي `0.2.x` أو `1.0.x`)، غيّر `version` في `apps/pos/package.json`.

---

## الخطوة 0: نعرف السيرفر عليه إيه

ادخل على السيرفر بـ SSH، واكتب البورت الحقيقي مكان `22`:

```bash
ssh root@0x01source.com -p 22
```

بعدها شغّل:

```bash
uname -a
cat /etc/os-release | head -3
which nginx apache2 httpd caddy 2>/dev/null
sudo ss -ltnp | grep -E ':7788|:443|:80'
ls -la /srv /srv/InnoForge 2>/dev/null
```

**✅ ابعتلي** الناتج، عشان أعرف أنهي برنامج بيشغّل البورت 7788 (nginx ولا Apache ولا غيره).

---

## الخطوة 1: مستخدم مخصوص للرفع + الفولدر

مستخدم اسمه `deploy`، مسموحله يكتب في فولدر التحديثات بس، ومش بيدخل بباسورد:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /srv/InnoForge/PoS
sudo chown -R deploy:deploy /srv/InnoForge/PoS
sudo chmod 755 /srv /srv/InnoForge /srv/InnoForge/PoS
```

> لو `adduser` مش موجود (زي CentOS)، استخدم `sudo useradd -m deploy`.

---

## الخطوة 2: مفتاح SSH للرفع

ده **مفتاح تاني غير مفتاح التراخيص**. وظيفته بس إنه يخلي GitHub يدخل السيرفر كمستخدم `deploy`.

**على جهازك إنت (لينكس)، مش على السيرفر:**

```bash
ssh-keygen -t ed25519 -f ~/pos-deploy -N "" -C "github-pos-deploy"
cat ~/pos-deploy.pub
```

ده بيعمل ملفين:
- `~/pos-deploy`: **الخاص**، وده اللي هيتحط في GitHub.
- `~/pos-deploy.pub`: **العام**، وده اللي هيتحط على السيرفر.

**على السيرفر:** حط المفتاح العام مكان `ssh-ed25519 AAAA...`:

```bash
sudo mkdir -p /home/deploy/.ssh
echo "ssh-ed25519 AAAA...الصق هنا محتوى pos-deploy.pub... github-pos-deploy" | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

**جرّب من جهازك:**

```bash
ssh -i ~/pos-deploy -p 22 deploy@0x01source.com "echo ok > /srv/InnoForge/PoS/test.txt && ls -la /srv/InnoForge/PoS"
```

**✅ ابعتلي** الناتج. المفروض يظهر فيه `test.txt`.

---

## الخطوة 3: السيرفر يعرض الفولدر على 7788 بشهادة HTTPS سليمة

افتح في المتصفح:

```
https://0x01source.com:7788/srv/InnoForge/PoS/test.txt
```

- **لو ظهرت كلمة `ok` من غير أي تحذير أمان:** ممتاز، روح للخطوة 4.
- **لو ظهر تحذير شهادة:** البرنامج هيرفض التحديث. لازم شهادة حقيقية (Let's Encrypt مجانية).
- **لو ظهر 404:** الويب سيرفر محتاج يعرف الفولدر. لو nginx، ضيف ده في `server` الخاص بالبورت 7788:

```nginx
server {
    listen 7788 ssl;
    server_name 0x01source.com;
    ssl_certificate     /etc/letsencrypt/live/0x01source.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/0x01source.com/privkey.pem;

    # ملفات تحديث InnoForge POS
    location /srv/InnoForge/PoS/ {
        alias /srv/InnoForge/PoS/;
        autoindex off;
    }
    # "كارت" النسخة لازم ميتخزنش (cache) عشان العملاء يشوفوا النسخة الجديدة على طول
    location ~ ^/srv/InnoForge/PoS/(latest.*\.yml)$ {
        alias /srv/InnoForge/PoS/$1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

بعدها:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

لو محتاج شهادة Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx   # مرة واحدة
sudo certbot certonly --nginx -d 0x01source.com
```

**✅ ابعتلي** اللي ظهرلك في المتصفح. ولو Apache أو حاجة تانية، قولّي وهديك الإعداد بتاعها.

---

## الخطوة 4: الأسرار (Secrets) في GitHub

افتح: **https://github.com/GeekAhmeds/InnoForge/settings/secrets/actions**، واضغط **New repository secret** لكل سطر:

| الاسم (Name) | القيمة (Secret) |
|---|---|
| `POS_SIGNING_KEY` | افتح `pos-license-private.pem` بأي محرر نصوص، وانسخ **كل** اللي فيه بما فيه سطرين `-----BEGIN PRIVATE KEY-----` و `-----END PRIVATE KEY-----` |
| `POS_DEPLOY_HOST` | `0x01source.com` |
| `POS_DEPLOY_PORT` | بورت SSH (مثلاً `22`) |
| `POS_DEPLOY_USER` | `deploy` |
| `POS_DEPLOY_KEY` | محتوى الملف `~/pos-deploy` (الخاص، **مش** `.pub`): `cat ~/pos-deploy` وانسخ كله |
| `POS_DEPLOY_PATH` | `/srv/InnoForge/PoS` |

> الأسرار دي محدش يقدر يشوفها تاني بعد ما تتحفظ، ولا حتى إنت. GitHub بيستخدمها بس وقت البناء.

**✅ ابعتلي** لما تخلّص، من غير ما تبعت القيم نفسها.

---

## الخطوة 5: أول رفع (تجربة)

1. افتح: **https://github.com/GeekAhmeds/InnoForge/actions/workflows/pos-installer.yml**
2. اضغط **Run workflow**، واختار الفرع `claude/amazing-noether-jd4woa`، وعلّم ✔ على **publish**، واضغط **Run workflow**.
3. استنى حوالي 5 دقايق. المفروض يبقى فيه 3 مربعات خضرا: `build (Windows)`، و`build (Linux)`، و`publish`.
4. افتح في المتصفح: `https://0x01source.com:7788/srv/InnoForge/PoS/latest.yml`. المفروض يظهر فيه `version: 0.1.xx`.

**✅ ابعتلي** صورة أو الناتج. ولو حاجة طلعت حمرا، ابعتلي لينك التشغيل وهقرا السبب.

---

## الخطوة 6: الدمج في main (عشان الرفع يبقى تلقائي)

لما نتأكد إن الرفع اشتغل:
- أعمل Pull Request من الفرع بتاعنا لـ `main`، وإنت توافق عليه.
- من بعدها أي تعديل يتدمج في `main` بيترفع لوحده.
- وتقدر دايماً ترفع أي فرع يدوي بنفس الطريقة اللي في الخطوة 5.

---

## الخطوة 7: نخلي المستودع خاص (Private)

**Settings ← General ← Danger Zone ← Change repository visibility ← Make private**

> ملحوظة: في المستودعات الخاصة، GitHub بيدّي **2000 دقيقة مجاناً كل شهر**، ودقايق الويندوز بتتحسب ×2. كل بناء بياخد حوالي 3 دقايق لينكس و3 ويندوز، يعني حوالي 9 دقايق محسوبة، يعني حوالي 200 بناء في الشهر. كفاية جداً.

---

## لو حصلت مشكلة

| المشكلة | السبب الغالب |
|---|---|
| `publish` حمرا وفيها "POS_SIGNING_KEY secret is missing" | المفتاح مش متحط أو اتنسخ ناقص (لازم سطرين BEGIN و END). |
| `Permission denied (publickey)` | `POS_DEPLOY_KEY` مش هو الخاص، أو الـ `.pub` مش في `authorized_keys`، أو صلاحيات `.ssh` غلط. |
| البرنامج عند العميل مش شايف التحديث | `latest.yml` مش ظاهر في المتصفح، أو الشهادة فيها مشكلة، أو الفولدر غلط. |
| البرنامج بيقول التحديث مرفوض | ملف `.sig` مش موجود، أو اتوقّع بمفتاح تاني غير اللي جوه البرنامج. |

## أمان

- `pos-license-private.pem`: اعمله نسخة على فلاشة أو مكان آمن **أوفلاين**. لو ضاع، مش هتقدر تطلّع تراخيص ولا توقّع تحديثات جديدة.
- `pos-deploy` (مفتاح الرفع): لو حسيت إنه اتسرّب، امسح سطره من `/home/deploy/.ssh/authorized_keys` واعمل واحد جديد.
- المستخدم `deploy` مش بيقدر يعمل حاجة غير الكتابة في فولدر التحديثات.
