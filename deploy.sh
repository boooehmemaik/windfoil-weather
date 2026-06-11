#!/bin/bash
# deploy.sh — WindFoil Weather Intelligence · vollständiges Deployment
# v2.2.0
#
# Holt die neueste Version aus Git und bringt sie live:
#   git pull → npm install → vendor prüfen → index.html setzen
#   → proxy neu starten → nginx neu laden → Health-Checks
#
# Aufruf auf dem Host:
#   cd /var/www/windfoil && bash deploy.sh
#
# Beendet sich bei jedem Fehler (set -e) und meldet, wo es klemmt.

set -euo pipefail

# ── Konfiguration ─────────────────────────────────────────────────────────────
APP_DIR="/var/www/windfoil"
FRONTEND_SRC="app-react-local.html"   # lokale (vendor) Variante
FRONTEND_DST="index.html"
PROXY_SERVICE="windfoil-proxy"
WEB_USER="www-data"
PROXY_HEALTH="http://localhost:8787/api/station/health"
NGINX_HEALTH="https://localhost:443"

# ── Hübsche Ausgabe ───────────────────────────────────────────────────────────
step()  { echo -e "\n\033[1;36m▶ $*\033[0m"; }
ok()    { echo -e "  \033[1;32m✓\033[0m $*"; }
warn()  { echo -e "  \033[1;33m⚠\033[0m $*"; }
fail()  { echo -e "  \033[1;31m✗ $*\033[0m"; exit 1; }

cd "$APP_DIR" || fail "Verzeichnis $APP_DIR nicht gefunden"

echo "════════════════════════════════════════════"
echo "  WindFoil Deployment — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════"

# ── 1. Git pull ───────────────────────────────────────────────────────────────
step "1/7 · Hole neueste Version aus Git"
if [ -d .git ]; then
  CURRENT=$(git rev-parse --short HEAD 2>/dev/null || echo "unbekannt")
  git pull --ff-only origin main || fail "git pull fehlgeschlagen (lokale Änderungen? → 'git status')"
  NEW=$(git rev-parse --short HEAD)
  if [ "$CURRENT" = "$NEW" ]; then
    ok "Bereits aktuell ($NEW) — keine neuen Commits"
  else
    ok "Aktualisiert: $CURRENT → $NEW"
  fi
else
  fail "Kein Git-Repository in $APP_DIR"
fi

# ── 2. npm install (nur wenn package.json existiert) ──────────────────────────
step "2/7 · Proxy-Abhängigkeiten (npm)"
if [ -f package.json ]; then
  npm install --omit=dev --no-audit --no-fund || fail "npm install fehlgeschlagen"
  ok "node_modules aktuell"
else
  warn "Keine package.json — übersprungen"
fi

# ── 3. Vendor-Bibliotheken prüfen ─────────────────────────────────────────────
step "3/7 · Frontend-Bibliotheken (vendor/)"
NEED=(react.production.min.js react-dom.production.min.js react-is.production.min.js prop-types.min.js Recharts.js babel.min.js)
MISSING=0
for f in "${NEED[@]}"; do
  if [ ! -s "vendor/$f" ]; then
    warn "fehlt oder leer: vendor/$f"
    MISSING=1
  fi
done
if [ "$MISSING" = "1" ]; then
  if [ -f fetch-vendor.sh ]; then
    warn "Lade fehlende Bibliotheken nach…"
    bash fetch-vendor.sh || fail "fetch-vendor.sh fehlgeschlagen"
    ok "vendor/ wiederhergestellt"
  else
    fail "vendor/ unvollständig und fetch-vendor.sh fehlt"
  fi
else
  ok "Alle 6 Bibliotheken vorhanden"
fi

# ── 4. Frontend aktivieren ────────────────────────────────────────────────────
step "4/7 · Frontend aktivieren ($FRONTEND_SRC → $FRONTEND_DST)"
if [ -f "$FRONTEND_SRC" ]; then
  cp "$FRONTEND_SRC" "$FRONTEND_DST"
  ok "$FRONTEND_DST aktualisiert ($(du -h "$FRONTEND_DST" | cut -f1))"
else
  fail "$FRONTEND_SRC nicht gefunden"
fi

# ── 5. Rechte setzen ──────────────────────────────────────────────────────────
step "5/7 · Dateirechte ($WEB_USER)"
chown -R "$WEB_USER:$WEB_USER" "$APP_DIR" 2>/dev/null \
  && ok "Eigentümer = $WEB_USER" \
  || warn "chown nicht möglich (nicht als root?) — übersprungen"

# ── 6. Dienste neu starten ────────────────────────────────────────────────────
step "6/7 · Dienste neu starten"
# Proxy
if systemctl list-unit-files | grep -q "$PROXY_SERVICE"; then
  systemctl restart "$PROXY_SERVICE" && ok "Proxy ($PROXY_SERVICE) neu gestartet" \
    || fail "Proxy-Neustart fehlgeschlagen — 'journalctl -u $PROXY_SERVICE -n 30'"
else
  warn "Dienst $PROXY_SERVICE nicht installiert — übersprungen"
fi
# nginx (erst Syntax prüfen, dann reload)
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && ok "nginx neu geladen" || fail "nginx reload fehlgeschlagen"
else
  fail "nginx-Konfiguration fehlerhaft — 'nginx -t' prüfen"
fi

# ── 7. Health-Checks ──────────────────────────────────────────────────────────
step "7/7 · Health-Checks"
sleep 1
# Proxy
if curl -fsS "$PROXY_HEALTH" >/dev/null 2>&1; then
  ok "Proxy erreichbar ($PROXY_HEALTH)"
else
  warn "Proxy antwortet nicht — evtl. Key fehlt oder Dienst aus (App läuft trotzdem ohne Vertrauens-Score)"
fi
# nginx / Frontend
if curl -fsSk -o /dev/null -w "%{http_code}" "$NGINX_HEALTH" 2>/dev/null | grep -q "200"; then
  ok "Frontend erreichbar (HTTP 200)"
else
  warn "Frontend-Check unklar — manuell im Browser prüfen"
fi

echo ""
echo "════════════════════════════════════════════"
echo -e "  \033[1;32mDeployment abgeschlossen.\033[0m"
echo "════════════════════════════════════════════"
