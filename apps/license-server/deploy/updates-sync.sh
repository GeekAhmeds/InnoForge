#!/usr/bin/env bash
# Pulls the newest published POS release (tag pos-v…, not a pre-release) from GitHub Releases
# into the update folder that https://pos.0x01source.com:9990/updates/ serves. Runs every
# 10 minutes (systemd timer installed by install-inno.sh). CI makes pre-releases: a version
# reaches customers only after someone unticks «Set as a pre-release» on GitHub (or runs it once
# with TAG=pos-v…). GitHub's single "Latest" badge is not used, so other apps in the same repo
# (e.g. azim-v…) can keep it. It never moves customers back to an older version.
#
# Safe swap: files are downloaded to a temp folder on the same disk, sizes checked, installers
# moved in first and the latest*.yml files last, so an app never sees a version whose file is
# not there yet. The last 3 versions' installers are kept.
set -euo pipefail
REPO=${REPO:-GeekAhmeds/InnoForge}
DEST=${DEST:-/srv/InnoForge/PoS}
KEEP=${KEEP:-3}
API=${API:-https://api.github.com}
[ -f /etc/innoforge-updates.env ] && . /etc/innoforge-updates.env   # optional GITHUB_TOKEN (private repo)
AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")

log() { echo "[innoforge-updates] $*"; }

current=$(cat "$DEST/.release" 2>/dev/null || true)
gh() { curl -fsSL --max-time 30 "${AUTH[@]}" -H "Accept: application/vnd.github+json" "$API/repos/$REPO/$1"; }

# TAG=pos-v0.1.44 innoforge-updates-sync  → publish that exact release now (even a pre-release or an older one).
if [ -n "${TAG:-}" ]; then
  json=$(gh "releases/tags/$TAG") || { log "release $TAG not found"; exit 1; }
else
  list=$(gh "releases?per_page=100") || { log "GitHub not reachable"; exit 0; }
  # The highest pos-v version that is published (not a draft, not a pre-release), and newer than what is served.
  tag=$(printf '%s' "$list" | CURRENT="$current" python3 -c '
import json, os, re, sys
ver = lambda t: tuple(int(x) for x in re.findall(r"\d+", t[len("pos-v"):]))
ok = [r["tag_name"] for r in json.load(sys.stdin)
      if r["tag_name"].startswith("pos-v") and not r["draft"] and not r["prerelease"] and re.fullmatch(r"pos-v\d+(\.\d+)*", r["tag_name"])]
cur = os.environ["CURRENT"]
best = max(ok, key=ver, default="")
print(best if best and (not cur.startswith("pos-v") or ver(best) > ver(cur)) else "")')
  [ -n "$tag" ] || exit 0   # nothing newer than what customers already get
  json=$(gh "releases/tags/$tag") || { log "GitHub not reachable"; exit 0; }
fi
tag=$(printf '%s' "$json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')
case "$tag" in pos-v*) ;; *) log "$tag is not a POS release — nothing to do"; exit 0;; esac
[ "$tag" = "$current" ] && exit 0

log "new release $tag (was ${current:-none})"
work=$(mktemp -d "$DEST/.incoming-XXXXXX")
trap 'rm -rf "$work"' EXIT
printf '%s' "$json" | python3 -c '
import json,sys
for a in json.load(sys.stdin)["assets"]:
    print(a["name"], a["size"], a["url"])' | while read -r name size url; do
  case "$name" in */*|.*) log "skipping odd asset name $name"; continue;; esac
  curl -fsSL --max-time 900 "${AUTH[@]}" -H "Accept: application/octet-stream" -o "$work/$name" "$url"
  got=$(stat -c %s "$work/$name")
  [ "$got" = "$size" ] || { log "size mismatch for $name ($got != $size)"; exit 1; }
done

ls "$work"/latest*.yml >/dev/null 2>&1 || { log "release has no latest*.yml — not a POS update"; exit 1; }
for f in "$work"/*.exe "$work"/*.AppImage; do
  [ -e "$f" ] || continue
  [ -s "$f.sig" ] || { log "$(basename "$f") has no signature — refusing (apps would reject it anyway)"; exit 1; }
done

owner=$(stat -c %u:%g "$DEST")
chown "$owner" "$work"/* 2>/dev/null || true
chmod 644 "$work"/*
for f in "$work"/*; do case "$f" in *.yml) ;; *) mv -f "$f" "$DEST/";; esac; done
for f in "$work"/*.yml; do mv -f "$f" "$DEST/"; done
echo "$tag" > "$DEST/.release"

# Keep the newest $KEEP versions of each installer kind.
for ext in exe AppImage deb; do
  { ls -1t "$DEST"/*."$ext" 2>/dev/null || true; } | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "$old.sig" "$old.blockmap"
  done
done
log "published $tag to $DEST"
