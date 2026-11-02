#!/bin/bash
# WindFoil — Claude Code Service Setup
# Run as root: bash /var/www/windfoil/setup-claude-service.sh
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*"; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte als root ausführen: sudo bash $0"

echo "═══════════════════════════════════════════"
echo "  WindFoil — Claude Code Service Setup"
echo "═══════════════════════════════════════════"

# ── 1. Agent-Loop-Script ausführbar machen ───────────────────────────────────
LOOP_SCRIPT=/var/www/windfoil/claude-agent-loop.sh
[[ -f "$LOOP_SCRIPT" ]] || die "Nicht gefunden: $LOOP_SCRIPT"
chmod +x "$LOOP_SCRIPT"
ok "chmod +x $LOOP_SCRIPT"

# ── 2. Systemd-Service schreiben ─────────────────────────────────────────────
cat > /etc/systemd/system/claude-code.service << 'EOF'
[Unit]
Description=Claude Code Autonomous Agent Loop — WindFoil
After=network.target windfoil-proxy.service
Wants=windfoil-proxy.service

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/windfoil
ExecStart=/bin/bash /var/www/windfoil/claude-agent-loop.sh
Restart=on-failure
RestartSec=60
StandardOutput=journal
StandardError=journal
SyslogIdentifier=claude-code

[Install]
WantedBy=multi-user.target
EOF
ok "Systemd-Service geschrieben: /etc/systemd/system/claude-code.service"

# ── 3. Sudoers-Einträge (www-data darf den Service steuern) ──────────────────
SUDOERS=/etc/sudoers.d/windfoil-claude
cat > "$SUDOERS" << 'EOF'
www-data ALL=(root) NOPASSWD: /usr/bin/systemctl start claude-code
www-data ALL=(root) NOPASSWD: /usr/bin/systemctl stop claude-code
www-data ALL=(root) NOPASSWD: /usr/bin/systemctl restart claude-code
www-data ALL=(root) NOPASSWD: /usr/bin/systemctl is-active claude-code
www-data ALL=(root) NOPASSWD: /usr/bin/journalctl -u claude-code -n 50 --no-pager
EOF
chmod 440 "$SUDOERS"
visudo -c -f "$SUDOERS" || die "Sudoers-Syntax fehlerhaft — bitte prüfen"
ok "Sudoers geschrieben und validiert: $SUDOERS"

# ── 4. Log-Verzeichnis anlegen ────────────────────────────────────────────────
mkdir -p /var/log/windfoil
ok "Log-Verzeichnis: /var/log/windfoil"

# ── 5. Systemd laden + Service aktivieren ────────────────────────────────────
systemctl daemon-reload
systemctl enable claude-code
ok "claude-code.service aktiviert (autostart)"

# ── 6. Service starten ────────────────────────────────────────────────────────
systemctl start claude-code
sleep 2

STATUS=$(systemctl is-active claude-code 2>/dev/null || true)
if [[ "$STATUS" == "active" ]]; then
  ok "claude-code ist aktiv (running)"
else
  warn "claude-code Status: $STATUS — prüfe: journalctl -u claude-code -n 30"
fi

# ── 7. Zusammenfassung ────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Setup abgeschlossen"
echo "═══════════════════════════════════════════"
echo "  Admin-Panel:  https://maik.surf/admin.html"
echo "  Live-Log:     journalctl -fu claude-code"
echo "  Status:       systemctl status claude-code"
echo "═══════════════════════════════════════════"
