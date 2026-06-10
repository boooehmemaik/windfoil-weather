#!/bin/bash

# Konfiguration
REMOTE_USER="root"
REMOTE_HOST="192.168.99.113"
REMOTE_DIR="/var/www/windfoil/ "
LOCAL_DIR="/Users/mboehme/downloads/WindApp/"

# Sicherstellen, dass das lokale Zielverzeichnis existiert
mkdir -p "$LOCAL_DIR"

echo "--- Starte Sync: Server -> Mac ---"

# rsync ausführen
rsync -avz --progress -e ssh $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR $LOCAL_DIR

echo "--- Sync abgeschlossen ---"

