#!/bin/bash
# Claude Code autonomous agent loop for WindFoil.
# Permissions are granted via /var/www/windfoil/.claude/settings.json (not --dangerously-skip-permissions).
# Logs to /var/log/windfoil/claude-agent.log.

LOG_DIR=/var/log/windfoil
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/claude-agent.log"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

cd /var/www/windfoil

PROMPT="Du bist ein autonomer Wartungs-Agent für das WindFoil-Projekt (/var/www/windfoil, maik.surf).

Aufgaben dieser Iteration:
1. Prüfe ob windfoil-proxy und nginx aktiv sind (systemctl is-active).
2. Scanne /var/log/windfoil/ auf ERROR-Zeilen der letzten 60 Minuten.
3. Prüfe ob die SQLite-DB /var/www/windfoil/data/windfoil.db erreichbar ist.
4. Wenn du Probleme findest, behebe sie und erstelle einen kurzen Bericht.
5. Wenn alles ok ist, antworte nur: STATUS OK — keine weiteren Aktionen nötig.

Halte deine Antwort kurz (max 10 Zeilen)."

while true; do
  log "=== Agent-Loop start ==="
  /usr/local/bin/claude --print "$PROMPT" >> "$LOG" 2>&1 || log "WARNING: claude exited with code $?"
  log "=== Agent-Loop done, sleep 30m ==="
  sleep 1800
done
