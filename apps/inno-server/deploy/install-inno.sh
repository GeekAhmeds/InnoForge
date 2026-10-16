#!/usr/bin/env bash
# Installs Inno Server (Azim Command: sync, accounts, mobile API, update feed) on the
# office server "inno", next to everything already running there (the POS license
# server included), WITHOUT changing anything that exists:
#   - the server runs in Docker on 127.0.0.1:9991 only (not reachable from outside directly);
#   - nginx gets ONE new file (sites-available/zz-azim-command) for a NEW host name on the
#     already-forwarded HTTPS port 9990, with the existing *.0x01source.com certificate;
#   - nginx is backed up first and tested before reload; if the test fails our file is removed;
#   - a systemd timer pulls new Azim Command releases from GitHub every 10 minutes
#     (azim-updates-sync.sh) — the same pull model as the POS updates.
# Run it again any time to update the server to the latest code; data and tokens are kept.
# Undo with uninstall-inno.sh.
#
#   sudo bash install-inno.sh
#   sudo HOST=azim.0x01source.com PORT=9990 bash install-inno.sh
#   sudo NO_NGINX=1 bash install-inno.sh   # no nginx/certificate: plain HTTP on 0.0.0.0:9991
set -euo pipefail

HOST=${HOST:-azim.0x01source.com}       # needs a DNS A record → the office IP (like pos / ls.0x01source.com)
PORT=${PORT:-9990}                      # an nginx HTTPS port the router already forwards to inno
APP_PORT=${APP_PORT:-9991}
DIR=${DIR:-/opt/inno}
CERT=${CERT:-/etc/letsencrypt/live/0x01source.com-0001}
REPO=${REPO:-https://github.com/GeekAhmeds/InnoForge.git}
BRANCH=${BRANCH:-claude/azim-company-data-manager-gkr645}
NO_NGINX=${NO_NGINX:-}
PROJECT=inno-server
SITE=/etc/nginx/sites-available/zz-azim-command
LINK=/etc/nginx/sites-enabled/zz-azim-command
SRV=$DIR/apps/inno-server

# Running from the checkout it updates (git checkout below rewrites this file): run a copy.
if [ -z "${INNO_COPY:-}" ] && [ "$(dirname "$(readlink -f "$0")")" = "$SRV/deploy" ]; then
  tmp=$(mktemp)
  cp "$0" "$tmp"
  INNO_COPY=1 exec bash "$tmp" "$@"
fi

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok() { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "شغّله بـ sudo"

say "1) فحص قبل أي حاجة (مفيش تغيير لسه)"
command -v docker >/dev/null || die "Docker مش متسطب"
docker compose version >/dev/null 2>&1 || die "docker compose مش موجود"
command -v git >/dev/null || die "git مش متسطب"
command -v python3 >/dev/null || die "python3 مش متسطب"
if command -v ss >/dev/null && ss -ltn "( sport = :$APP_PORT )" | grep -q LISTEN && ! docker ps --format '{{.Names}}' | grep -q "^$PROJECT"; then
  die "البورت $APP_PORT مستخدم في حاجة تانية — شغّل بـ APP_PORT=9992 مثلاً"
fi
ok "البورت $APP_PORT فاضي"
EXISTING=${CHECK_HOST:-ls.0x01source.com}   # a site already on $PORT, checked before and after
BEFORE=""
if [ -z "$NO_NGINX" ]; then
  command -v nginx >/dev/null || die "nginx مش متسطب — أو شغّل بـ NO_NGINX=1 (HTTP بس على $APP_PORT)"
  nginx -t >/dev/null 2>&1 || die "إعدادات nginx الحالية فيها مشكلة أصلاً — صلّحها الأول (nginx -t)"
  ok "nginx الحالي سليم"
  [ -f "$CERT/fullchain.pem" ] && [ -f "$CERT/privkey.pem" ] || die "الشهادة مش موجودة في $CERT (حدد مكانها بـ CERT=...)"
  ok "الشهادة موجودة"
  ss -ltnp "( sport = :$PORT )" | grep -q nginx || die "nginx مش شغال على $PORT — اختار بورت الراوتر بيحوّله لـ inno (PORT=...)"
  ok "nginx شغال على $PORT"
  if grep -rqs --exclude="$(basename "$SITE")" -E "server_name[^;]*[[:space:]]${HOST}[[:space:];]" /etc/nginx/sites-enabled/; then
    die "الاسم $HOST مستخدم في إعداد تاني — اختار اسم تاني (HOST=...)"
  fi
  ok "الاسم $HOST مش مستخدم"
  if [ -n "$EXISTING" ]; then
    BEFORE=$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "$EXISTING:$PORT:127.0.0.1" "https://$EXISTING:$PORT/" || true)
    ok "الموقع الموجود ($EXISTING:$PORT) بيرد دلوقتي بـ $BEFORE — هنتأكد إنه فضل زي ما هو"
  fi
fi

say "2) الكود في $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
ok "$(git -C "$DIR" log -1 --format='%h %s' | cut -c1-80)"
cd "$SRV"

say "3) الإعدادات (.env)"
BIND=127.0.0.1
[ -n "$NO_NGINX" ] && BIND=0.0.0.0
if [ ! -f .env ]; then
  touch .env && chmod 600 .env
  cat > .env <<ENV
# Inno Server — Inno Source For Software Solutions (created by install-inno.sh)
INNO_APPS=azim-command
INNO_OWNER_TOKENS=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
INNO_PUBLISH_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
BIND=$BIND
APP_PORT=$APP_PORT
ENV
  ok "اتعمل .env بتوكنات عشوائية"
else
  sed -i "s/^BIND=.*/BIND=$BIND/;s/^APP_PORT=.*/APP_PORT=$APP_PORT/" .env
  grep -q '^BIND=' .env || echo "BIND=$BIND" >> .env
  grep -q '^APP_PORT=' .env || echo "APP_PORT=$APP_PORT" >> .env
  ok ".env موجود من قبل — التوكنات زي ما هي"
fi
OWNER_TOKEN=$(grep '^INNO_OWNER_TOKENS=' .env | cut -d= -f2 | cut -d, -f1)
PUBLISH_TOKEN=$(grep '^INNO_PUBLISH_TOKEN=' .env | cut -d= -f2)

say "4) تشغيل السيرفر (Docker) — أول مرة بياخد كام دقيقة"
docker compose -p "$PROJECT" up -d --build
for _ in $(seq 1 60); do
  curl -fs --noproxy '*' "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fs --noproxy '*' "http://127.0.0.1:$APP_PORT/api/health" >/dev/null || { docker compose -p "$PROJECT" logs --tail 40; die "السيرفر مقامش — اللوج فوق"; }
ok "السيرفر شغال على $BIND:$APP_PORT"

if [ -z "$NO_NGINX" ]; then
  say "5) nginx — ملف جديد بس (نسخة احتياطية الأول)"
  BACKUP=/root/nginx-backup-$(date +%F-%H%M%S).tgz
  tar czf "$BACKUP" -C / etc/nginx
  ok "نسخة احتياطية: $BACKUP"
  cat > "$SITE" <<NGINX
# Inno Server — Azim Command (sync, accounts, mobile API, update feed).
# Added by apps/inno-server/deploy/install-inno.sh; remove with uninstall-inno.sh.
server {
    listen $PORT ssl http2;
    server_name $HOST;
    ssl_certificate     $CERT/fullchain.pem;
    ssl_certificate_key $CERT/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 1g;          # original documents and installers
    add_header X-Content-Type-Options nosniff always;

    # Live release announcements (server-sent events): no buffering, long-lived.
    location ~ ^/api/[^/]+/events\$ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGINX
  ln -sf "$SITE" "$LINK"
  NGINX_TEST=$(mktemp)
  if ! nginx -t 2>"$NGINX_TEST"; then
    rm -f "$LINK" "$SITE"
    cat "$NGINX_TEST"; rm -f "$NGINX_TEST"
    die "اختبار nginx فشل — شيلت الملف الجديد، ومفيش أي حاجة اتغيرت في nginx"
  fi
  rm -f "$NGINX_TEST"
  systemctl reload nginx
  ok "nginx اتعمله reload (من غير ما يقفل أي اتصال شغال)"
fi

say "6) سحب تحديثات Azim Command أوتوماتيك من GitHub (كل 10 دقايق)"
touch /etc/azim-updates.env && chmod 600 /etc/azim-updates.env
cat > /etc/azim-updates.env <<ENV
INNO_PUBLISH_TOKEN=$PUBLISH_TOKEN
SERVER=http://127.0.0.1:$APP_PORT
# GITHUB_TOKEN=        only if the repository becomes private
ENV
bash "$SRV/deploy/azim-updates-sync.sh" --install >/dev/null
systemctl start azim-updates.service || true
ok "اتظبط (اللوج: journalctl -u azim-updates)"

say "7) التأكد"
if [ -z "$NO_NGINX" ]; then
  URL="https://$HOST:$PORT"
  H=$(curl -sk --noproxy '*' --resolve "$HOST:$PORT:127.0.0.1" "$URL/api/health" || true)
  if [ -n "$EXISTING" ]; then
    AFTER=$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --resolve "$EXISTING:$PORT:127.0.0.1" "https://$EXISTING:$PORT/" || true)
    [ "$AFTER" = "$BEFORE" ] && ok "الموقع الموجود ($EXISTING) زي ما هو ($AFTER)" || echo "   ⚠ الموقع الموجود كان $BEFORE وبقى $AFTER — ابعته فورًا (والتراجع: sudo bash $SRV/deploy/uninstall-inno.sh)"
  fi
  DNS=$(getent hosts "$HOST" | awk '{print $1}' || true)
  PUB=$(curl -s -m 5 https://ifconfig.me || true)
  [ -n "$DNS" ] && [ "$DNS" = "$PUB" ] && ok "الـ DNS لـ $HOST بيشاور على IP المكتب ($PUB)" || echo "   ⚠ لسه محتاج سجل DNS: $HOST  →  A  $PUB  (زي pos.0x01source.com)"
else
  URL="http://$(curl -s -m 5 https://ifconfig.me || echo '<IP>'):$APP_PORT"
  H=$(curl -s --noproxy '*' "http://127.0.0.1:$APP_PORT/api/health" || true)
  echo "   ⚠ HTTP من غير تشفير — الراوتر لازم يحوّل البورت $APP_PORT لـ inno"
fi
echo "   السيرفر: $H"
sleep 3
V=$(curl -s --noproxy '*' "http://127.0.0.1:$APP_PORT/api/azim-command/releases" || true)
echo "   التحديثات: $V"

cat <<NEXT

========================================================================
خلاص. البيانات اللي هتحطها في البرنامج (الإعدادات ← سيرفر Inno):
  رابط السيرفر:   $URL
  رمز المالك:     $OWNER_TOKEN
احفظ الرمز ده في مكان آمن — بيدّي صلاحية كاملة. (موجود كمان في $SRV/.env)

- التحديثات: أي إصدار azim-v* جديد على GitHub بينزل هنا خلال 10 دقايق،
  والبرامج المتثبتة بتحدّث نفسها.
- تحديث السيرفر نفسه لآخر كود: sudo bash $SRV/deploy/install-inno.sh
- النسخ الاحتياطي: الفولدر $SRV/data (قاعدة البيانات والملفات والتحديثات).
- التراجع عن كل حاجة: sudo bash $SRV/deploy/uninstall-inno.sh
========================================================================
NEXT
