#!/usr/bin/env bash
# Removes what install-inno.sh added: the nginx file and the containers.
# Data (database + server key) is kept unless you pass --purge.
set -euo pipefail
DIR=${DIR:-/opt/innoforge}
PROJECT=innoforge-licenses
SITE=/etc/nginx/sites-available/zz-innoforge-pos
LINK=/etc/nginx/sites-enabled/zz-innoforge-pos
[ "$(id -u)" = 0 ] || { echo "شغّله بـ sudo"; exit 1; }
rm -f "$LINK" "$SITE"
nginx -t && systemctl reload nginx
echo "✓ ملف nginx اتشال"
if [ -d "$DIR/apps/license-server" ]; then
  cd "$DIR/apps/license-server"
  if [ "${1:-}" = "--purge" ]; then
    docker compose -p "$PROJECT" down -v && echo "✓ السيرفر وبياناته اتشالوا"
  else
    docker compose -p "$PROJECT" down && echo "✓ السيرفر وقف (البيانات محفوظة — --purge لمسحها)"
  fi
fi
