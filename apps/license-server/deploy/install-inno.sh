#!/usr/bin/env bash
# Installs the InnoForge license server + the POS update files on the office server "inno",
# next to everything already running there, WITHOUT changing anything that exists:
#   - the app runs in Docker on 127.0.0.1:8020 only (not reachable from outside directly);
#   - nginx gets ONE new file (sites-available/zz-innoforge-pos) for a NEW host name on the
#     already-forwarded port 9990; existing sites keep working exactly as before;
#   - nginx is backed up first and tested before reload; if the test fails our file is removed.
# Undo everything with uninstall-inno.sh.
#
#   sudo bash install-inno.sh                    # defaults below
#   sudo HOST=pos.0x01source.com PORT=9990 bash install-inno.sh
set -euo pipefail

HOST=${HOST:-pos.0x01source.com}        # needs a DNS A record → the office IP (like ls.0x01source.com)
PORT=${PORT:-9990}                      # an nginx HTTPS port the router already forwards to inno
APP_PORT=${APP_PORT:-8020}              # local only
DIR=${DIR:-/opt/innoforge}
UPDATES=${UPDATES:-/srv/InnoForge/PoS}  # where the POS update files are (served at /updates/)
CERT=${CERT:-/etc/letsencrypt/live/0x01source.com-0001}
REPO=${REPO:-https://github.com/GeekAhmeds/InnoForge.git}
BRANCH=${BRANCH:-claude/amazing-noether-jd4woa}
PROJECT=innoforge-licenses
SITE=/etc/nginx/sites-available/zz-innoforge-pos
LINK=/etc/nginx/sites-enabled/zz-innoforge-pos

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok() { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "شغّله بـ sudo"

say "1) فحص قبل أي حاجة (مفيش تغيير لسه)"
command -v docker >/dev/null || die "Docker مش متسطب"
docker compose version >/dev/null 2>&1 || die "docker compose مش موجود"
command -v nginx >/dev/null || die "nginx مش متسطب"
command -v git >/dev/null || die "git مش متسطب"
nginx -t >/dev/null 2>&1 || die "إعدادات nginx الحالية فيها مشكلة أصلاً — صلّحها الأول (nginx -t)"
ok "nginx الحالي سليم"
[ -f "$CERT/fullchain.pem" ] && [ -f "$CERT/privkey.pem" ] || die "الشهادة مش موجودة في $CERT"
ok "الشهادة موجودة"
if ss -ltn "( sport = :$APP_PORT )" | grep -q LISTEN && ! docker ps --format '{{.Names}}' | grep -q "^$PROJECT"; then
  die "البورت $APP_PORT مستخدم في حاجة تانية — شغّل بـ APP_PORT=8021 مثلاً"
fi
ok "البورت المحلي $APP_PORT فاضي"
ss -ltnp "( sport = :$PORT )" | grep -q nginx || die "nginx مش شغال على $PORT — اختار بورت الراوتر بيحوّله لـ inno"
ok "nginx شغال على $PORT"
if grep -rqs --exclude="$(basename "$SITE")" -E "server_name[^;]*[[:space:]]${HOST}[[:space:];]" /etc/nginx/sites-enabled/; then
  die "الاسم $HOST مستخدم في إعداد تاني — اختار اسم تاني (HOST=...)"
fi
ok "الاسم $HOST مش مستخدم"
EXISTING=${CHECK_HOST:-ls.0x01source.com}   # a site already on $PORT, checked before and after
BEFORE=""
if [ -n "$EXISTING" ]; then
  BEFORE=$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "$EXISTING:$PORT:127.0.0.1" "https://$EXISTING:$PORT/" || true)
  ok "الموقع الموجود ($EXISTING:$PORT) بيرد دلوقتي بـ $BEFORE — هنتأكد إنه فضل زي ما هو"
fi

say "2) الكود في $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
ok "$(git -C "$DIR" log -1 --format='%h %s' | cut -c1-80)"
cd "$DIR/apps/license-server"

say "3) الإعدادات (.env)"
if [ ! -f .env ]; then
  rnd() { head -c 120 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  umask 077
  cat > .env <<ENV
DJANGO_SECRET_KEY=$(rnd 60)
DJANGO_ALLOWED_HOSTS=$HOST
DJANGO_CSRF_TRUSTED_ORIGINS=https://$HOST:$PORT
POSTGRES_DB=licenses
POSTGRES_USER=licenses
POSTGRES_PASSWORD=$(rnd 32)
TIME_ZONE=Africa/Cairo
CURRENCY=ج.م
PORT=$APP_PORT
ENV
  ok "اتعمل .env بأسرار عشوائية (محدش محتاج يعرفها)"
else
  ok ".env موجود من قبل — مش هيتغير"
fi

say "4) تشغيل السيرفر (Docker) — أول مرة بياخد كام دقيقة"
docker compose -p "$PROJECT" up -d --build
for _ in $(seq 1 60); do
  curl -fs --noproxy '*' -H "Host: $HOST" "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1 && break
  sleep 2
done
curl -fs --noproxy '*' -H "Host: $HOST" "http://127.0.0.1:$APP_PORT/healthz" >/dev/null || { docker compose -p "$PROJECT" logs --tail 40 web; die "السيرفر مقامش — اللوج فوق"; }
ok "السيرفر شغال على 127.0.0.1:$APP_PORT"
docker compose -p "$PROJECT" exec -T web python manage.py seed_prices
if docker compose -p "$PROJECT" exec -T web python manage.py license_signing status | grep -q "no-key"; then
  docker compose -p "$PROJECT" exec -T web python manage.py license_signing init
else
  echo "   مفتاح السيرفر موجود — المفتاح العام:"
  docker compose -p "$PROJECT" exec -T web python manage.py license_signing public
fi

say "5) nginx — ملف جديد بس (نسخة احتياطية الأول)"
BACKUP=/root/nginx-backup-$(date +%F-%H%M%S).tgz
tar czf "$BACKUP" -C / etc/nginx
ok "نسخة احتياطية: $BACKUP"
mkdir -p "$UPDATES"
cat > "$SITE" <<NGINX
# InnoForge — license server (/) + POS update files (/updates/).
# Added by apps/license-server/deploy/install-inno.sh; remove with uninstall-inno.sh.
server {
    listen $PORT ssl http2;
    server_name $HOST;
    ssl_certificate     $CERT/fullchain.pem;
    ssl_certificate_key $CERT/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 5m;
    add_header X-Content-Type-Options nosniff always;

    location /updates/ {
        alias $UPDATES/;
        autoindex off;
        add_header Cache-Control "no-cache";
    }
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sf "$SITE" "$LINK"
if ! nginx -t 2>/tmp/innoforge-nginx-test.txt; then
  rm -f "$LINK" "$SITE"
  cat /tmp/innoforge-nginx-test.txt
  die "اختبار nginx فشل — شيلت الملف الجديد، ومفيش أي حاجة اتغيرت في nginx"
fi
systemctl reload nginx
ok "nginx اتعمله reload (من غير ما يقفل أي اتصال شغال)"

say "6) التأكد"
sleep 1
H=$(curl -sk --noproxy '*' --resolve "$HOST:$PORT:127.0.0.1" "https://$HOST:$PORT/healthz" || true)
echo "   سيرفر التراخيص: $H"
U=$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "$HOST:$PORT:127.0.0.1" "https://$HOST:$PORT/updates/latest.yml" || true)
echo "   ملفات التحديث (/updates/latest.yml): $U"
if [ -n "$EXISTING" ]; then
  AFTER=$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "$EXISTING:$PORT:127.0.0.1" "https://$EXISTING:$PORT/" || true)
  [ "$AFTER" = "$BEFORE" ] && ok "الموقع الموجود ($EXISTING) زي ما هو ($AFTER)" || echo "   ⚠ الموقع الموجود كان $BEFORE وبقى $AFTER — ابعتلي ده فورًا (والتراجع: sudo bash uninstall-inno.sh)"
fi
DNS=$(getent hosts "$HOST" | awk '{print $1}' || true)
PUB=$(curl -s -m 5 https://ifconfig.me || true)
[ -n "$DNS" ] && [ "$DNS" = "$PUB" ] && ok "الـ DNS لـ $HOST بيشاور على IP المكتب ($PUB)" || echo "   ⚠ لسه محتاج سجل DNS: $HOST  →  A  $PUB  (زي ls.0x01source.com)"

cat <<NEXT

========================================================================
الخطوات الجاية (بإيدك):
  1) حساب المدير بتاعك:
     cd $DIR/apps/license-server && sudo docker compose -p $PROJECT exec web python manage.py createsuperuser
  2) المفتاح العام اللي فوق ← اعمل بيه تصريح من license-generator.html («تصاريح الموزّعين»):
     الكود SERVER، الاسم Inno Source، كل الباقات والإضافات، أقصى مدة «من غير حد»، ساري سنتين.
     وبعدين الصق التصريح في الموقع ← 🛡 توقيع السيرفر.
  3) الموقع: https://$HOST:$PORT      التحديثات: https://$HOST:$PORT/updates/
للتراجع عن كل حاجة: sudo bash $DIR/apps/license-server/deploy/uninstall-inno.sh
========================================================================
NEXT
