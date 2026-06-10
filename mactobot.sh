#!/bin/bash

# --- KONFIGURATION ---
# Hier trägst du deine spezifischen Daten ein
LOCAL_SOURCE="/Users/mboehme/downloads/WindApp/"  # Der Ordner auf deinem Mac
REMOTE_USER="root"                               # Dein Benutzername auf Ubuntu
REMOTE_HOST="192.168.99.113"                              # IP-Adresse deines Servers
REMOTE_TARGET="/var/www/windfoil/ "     # Zielpfad auf dem Server

# --- LOGIK ---

echo "---------------------------------------------------"
echo "

 Starte Deployment: Mac -> Ubuntu Server"
echo "---------------------------------------------------"

# Sicherstellen, dass der Quellordner existiert
if [ ! -d "$LOCAL_SOURCE" ]; then
    echo "

 Fehler: Quellordner $LOCAL_SOURCE nicht gefunden!"
    exit 1
fi

# rsync Befehl:
# -a: Archiv-Modus (behält Rechte/Daten bei)
# -v: Verbose (zeigt was passiert)
# -z: Komprimierung (schnellerer Transfer)
# --delete: Löscht Dateien auf dem Server, die lokal nicht mehr da sind (optional)
# --exclude: Ignoriert Dateien, die nicht auf den Server gehören (z.B. Git oder Mac-Systemdateien)

rsync -avz --progress \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    --exclude '__pycache__/' \
    --exclude '*.csv'  \
    --exclude '*.log' \
    -e ssh "$LOCAL_SOURCE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_TARGET"

if [ $? -eq 0 ]; then
    echo "---------------------------------------------------"
    echo "

 Erfolg: Alle Dateien wurden synchronisiert."
    echo "---------------------------------------------------"
else
    echo "---------------------------------------------------"
    echo "

 Fehler: Während der Synchronisation trat ein Problem auf."
    echo "---------------------------------------------------"
fi

