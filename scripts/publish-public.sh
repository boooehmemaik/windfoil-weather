#!/usr/bin/env bash
# publish-public.sh – kopiert NUR die öffentlichen Frontend-Dateien aus dem Repo
# nach /var/www/windfoil-public (nginx-Web-Root). Alles andere (Server-Code, .env,
# DB, .git, node_modules, Doku, Tests) existiert dort nicht und kann nie ausgeliefert werden.
#
# Aufruf: bash scripts/publish-public.sh   (deploy.sh ruft es automatisch auf)
# Nach JEDER Frontend-Änderung (HTML/JS/CSS/vendor/spots.json) ausführen.
# NIE direkt in /var/www/windfoil-public editieren – wird bei jedem Lauf überschrieben.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${WINDFOIL_PUBLIC_DIR:-/var/www/windfoil-public}"

mkdir -p "$DST"
rsync -a --delete --delete-excluded --delay-updates --prune-empty-dirs \
  --chown=root:root --chmod=D755,F644 \
  --exclude='/app-react*.html' --exclude='/vendor/babel.min.js' \
  --include='/*.html' \
  --include='/js/' --include='/js/**/' --include='/js/**.js' \
  --include='/css/' --include='/css/**/' --include='/css/**.css' \
  --include='/vendor/' --include='/vendor/*.js' \
  --include='/favicon.svg' --include='/icon-*.png' --include='/manifest.json' \
  --include='/sw.js' --include='/spots.json' \
  --exclude='*' \
  "$SRC/" "$DST/"

# ---- Cache-Busting nur in der veröffentlichten Kopie (Repo bleibt sauber für git pull)
if APP_VER=$(grep -oP 'v\K[0-9]+\.[0-9]+\.[0-9]+' "$SRC/js/app.js" | head -1) && [ -n "$APP_VER" ]; then
  sed -i "s|?v=[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*|?v=${APP_VER}|g" "$DST"/*.html
fi

# ---- Selbstprüfung -------------------------------------------------------
fail=0
# 1) Verbotenes darf nie im Web-Root liegen
bad=$(find "$DST" \( -name '.*' -o -name '*.env*' -o -name '*.db*' -o -name '*.md' \
        -o -name '*.mjs' -o -name '*.sh' -o -name '*.jsx' -o -name 'node_modules' \
        -o -name '*.service' -o -name 'package*.json' \) -print 2>/dev/null | grep -v "^$DST$" || true)
if [ -n "$bad" ]; then echo "FEHLER: verbotene Dateien im Web-Root:"; echo "$bad"; fail=1; fi
# 2) Lokale src=/href= Verweise der HTML-Seiten müssen existieren
while IFS= read -r ref; do
  p="${ref%%\?*}"; p="${p#./}"; p="${p#/}"
  [ -z "$p" ] && continue
  case "$p" in api/*|m/*) continue;; esac
  case "$p" in *'${'*|*"'"*|*'+'*) continue;; esac
  [ -e "$DST/$p" ] || { echo "FEHLER: $p wird referenziert, fehlt aber im Web-Root"; fail=1; }
done < <(grep -ohE '(src|href)="[^"#]+' "$DST"/*.html | sed -E 's/^(src|href)="//' \
          | grep -vE '^(https?:|//|mailto:|data:|tel:|javascript:)' | sort -u)

if [ "$fail" -ne 0 ]; then echo "publish-public: Selbstprüfung FEHLGESCHLAGEN"; exit 1; fi
echo "publish-public: $(find "$DST" -type f | wc -l) Dateien nach $DST veröffentlicht, Prüfung ok"
