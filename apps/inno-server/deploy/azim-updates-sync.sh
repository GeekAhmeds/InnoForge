#!/usr/bin/env bash
# Pulls the newest Azim Command release (tag azim-v*) from GitHub Releases into the
# Inno Server's update feed (/updates/azim-command/<os>/), the same pull model the
# InnoForge POS update server uses (apps/license-server/deploy/updates-sync.sh).
# Nothing has to be stored in GitHub: this server fetches, GitHub never pushes.
#
# It does not depend on GitHub's "Latest" badge (that one belongs to the POS):
# it takes the newest non-draft, non-pre-release azim-v* release.
#
# Files go through the server's own publish API on 127.0.0.1, so the release is
# recorded and every running copy of the app is told about it right away.
# Installers first, latest*.yml last: an app never sees a version whose file is
# not uploaded yet.
#
#   sudo bash azim-updates-sync.sh --install   # install a 10-minute systemd timer
#   sudo bash azim-updates-sync.sh             # run once now
#   sudo TAG=azim-v0.4.0 bash azim-updates-sync.sh   # publish that exact release
#
# Settings: /etc/azim-updates.env
#   INNO_PUBLISH_TOKEN=...      same value as in the Inno Server's .env (required)
#   SERVER=http://127.0.0.1:9991
#   GITHUB_TOKEN=...            only if the repository is private
set -euo pipefail
ENV_FILE=/etc/azim-updates.env
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
REPO=${REPO:-GeekAhmeds/InnoForge}
APP=${APP:-azim-command}
SERVER=${SERVER:-http://127.0.0.1:9991}
API=${API:-https://api.github.com}
STATE_DIR=${STATE_DIR:-/var/lib/azim-updates}

log() { echo "[azim-updates] $*"; }

if [ "${1:-}" = "--install" ]; then
  self=/usr/local/bin/azim-updates-sync
  install -m 755 "$0" "$self"
  if [ ! -f "$ENV_FILE" ]; then
    printf 'INNO_PUBLISH_TOKEN=\nSERVER=http://127.0.0.1:9991\n# GITHUB_TOKEN=\n' > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    log "created $ENV_FILE: put the Inno Server's INNO_PUBLISH_TOKEN in it"
  fi
  cat > /etc/systemd/system/azim-updates.service <<UNIT
[Unit]
Description=Pull Azim Command releases into the Inno Server update feed
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$self
UNIT
  cat > /etc/systemd/system/azim-updates.timer <<UNIT
[Unit]
Description=Check for new Azim Command releases every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now azim-updates.timer >/dev/null
  log "installed: systemctl list-timers azim-updates.timer · logs: journalctl -u azim-updates"
  exit 0
fi

[ -n "${INNO_PUBLISH_TOKEN:-}" ] || { log "INNO_PUBLISH_TOKEN is not set in $ENV_FILE"; exit 1; }
AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
mkdir -p "$STATE_DIR"

if [ -n "${TAG:-}" ]; then url="$API/repos/$REPO/releases/tags/$TAG"; else url="$API/repos/$REPO/releases?per_page=50"; fi
json=$(curl -fsSL --max-time 30 "${AUTH[@]}" -H "Accept: application/vnd.github+json" "$url") || { log "GitHub not reachable"; exit 0; }
release=$(printf '%s' "$json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
items = data if isinstance(data, list) else [data]
pick = next((r for r in items if r.get("tag_name", "").startswith("azim-v") and (not isinstance(data, list) or (not r.get("draft") and not r.get("prerelease")))), None)
if pick:
    print(pick["tag_name"])
    for a in pick["assets"]:
        print(a["name"], a["size"], a["url"])
')
[ -n "$release" ] || { log "no Azim Command release found"; exit 0; }
tag=$(printf '%s\n' "$release" | head -n1)
current=$(cat "$STATE_DIR/.release" 2>/dev/null || true)
[ "$tag" = "$current" ] && exit 0
log "new release $tag (was ${current:-none})"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$release" | tail -n +2 | while read -r name size asset; do
  case "$name" in */*|.*) log "skipping odd asset name $name"; continue;; esac
  curl -fsSL --max-time 900 "${AUTH[@]}" -H "Accept: application/octet-stream" -o "$work/$name" "$asset"
  got=$(stat -c %s "$work/$name")
  [ "$got" = "$size" ] || { log "size mismatch for $name ($got != $size)"; exit 1; }
done
ls "$work"/latest*.yml >/dev/null 2>&1 || { log "$tag has no latest*.yml (built before update manifests were attached) — skipping"; echo "$tag" > "$STATE_DIR/.release"; exit 0; }

os_of() {
  case "$1" in
    latest.yml|*.exe|*.exe.blockmap) echo win ;;
    latest-linux.yml|*.AppImage|*.deb) echo linux ;;
    latest-mac.yml|*.dmg|*.zip) echo mac ;;
    *) echo "" ;;
  esac
}
put() {
  local os; os=$(os_of "$1")
  [ -n "$os" ] || return 0
  curl -fsS --max-time 900 -X PUT -H "Authorization: Bearer $INNO_PUBLISH_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary "@$work/$1" "$SERVER/api/$APP/releases/$os/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1")" >/dev/null
  log "  $os/$1"
}
for f in "$work"/*; do n=$(basename "$f"); case "$n" in *.yml) ;; *) put "$n";; esac; done
for f in "$work"/*.yml; do put "$(basename "$f")"; done
# Drop installers that no manifest points to any more.
for os in win linux mac; do
  curl -fsS --max-time 60 -X POST -H "Authorization: Bearer $INNO_PUBLISH_TOKEN" "$SERVER/api/$APP/releases/$os/prune" >/dev/null 2>&1 || true
done
echo "$tag" > "$STATE_DIR/.release"
log "published $tag to $SERVER/updates/$APP/"
