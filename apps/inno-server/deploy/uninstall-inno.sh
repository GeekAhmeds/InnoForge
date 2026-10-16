#!/usr/bin/env bash
# Removes what install-inno.sh added: the nginx file, the update timer and the container.
# Data (database, files, tokens) is kept unless you pass --purge.
set -euo pipefail
DIR=${DIR:-/opt/inno}
PROJECT=inno-server
SITE=/etc/nginx/sites-available/zz-azim-command
LINK=/etc/nginx/sites-enabled/zz-azim-command
[ "$(id -u)" = 0 ] || { echo "شغّله بـ sudo"; exit 1; }
if [ -e "$SITE" ] || [ -L "$LINK" ]; then
  rm -f "$LINK" "$SITE"
  nginx -t && systemctl reload nginx
  echo "✓ ملف nginx اتشال"
fi
systemctl disable --now azim-updates.timer 2>/dev/null || true
rm -f /etc/systemd/system/azim-updates.{service,timer} /usr/local/bin/azim-updates-sync
systemctl daemon-reload || true
echo "✓ سحب التحديثات وقف"
if [ -d "$DIR/apps/inno-server" ]; then
  cd "$DIR/apps/inno-server"
  docker compose -p "$PROJECT" down && echo "✓ السيرفر وقف"
  if [ "${1:-}" = "--purge" ]; then
    rm -rf data .env /etc/azim-updates.env /var/lib/azim-updates && echo "✓ البيانات والتوكنات اتمسحت"
  else
    echo "  البيانات محفوظة في $DIR/apps/inno-server/data (--purge لمسحها)"
  fi
fi
