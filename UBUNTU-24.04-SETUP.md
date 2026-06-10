# Ubuntu 24.04 — Komplette Installationsanleitung

WindFoil Weather Intelligence v2.1.0 von Null auf einem frischen Ubuntu-24.04-Server.
Jeder Befehl ist zum Kopieren. Du brauchst SSH-Zugang als Benutzer mit `sudo`-Rechten und eine Domain, die auf die Server-IP zeigt.

**Platzhalter, die du ersetzen musst:**
- `windfoil.example.com` → deine echte Domain
- `DEIN_WEATHERBIT_KEY` → dein Weatherbit-API-Key
- `deinuser` → dein Linux-Benutzername

---

## Überblick: Was wird installiert

| Komponente | Zweck |
|------------|-------|
| **nginx** | Webserver — liefert die Seite aus, leitet `/api/` an den Proxy |
| **Node.js 22 + npm** | Laufzeit für den Backend-Proxy |
| **certbot** | Kostenloses SSL-Zertifikat (HTTPS) |
| **ufw** | Firewall |
| **WindFoil-Dateien** | `app-react.html`, `proxy-server.js`, `package.json` |

---

## Schritt 0 — Mit dem Server verbinden

```bash
ssh deinuser@windfoil.example.com
```

---

## Schritt 1 — System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Schritt 2 — Grundwerkzeuge installieren

```bash
sudo apt install -y curl ca-certificates gnupg ufw
```

---

## Schritt 3 — Firewall einrichten

```bash
# SSH offen halten (sonst sperrst du dich aus!)
sudo ufw allow OpenSSH

# Web-Ports öffnen
sudo ufw allow 'Nginx Full'      # öffnet Port 80 (HTTP) + 443 (HTTPS)

# Firewall aktivieren
sudo ufw enable

# Status prüfen
sudo ufw status
```

> Hinweis: Port 8787 (Proxy) bleibt **geschlossen** — er ist nur lokal erreichbar und wird von nginx intern angesprochen. Das ist gewollt.

---

## Schritt 4 — nginx installieren

```bash
sudo apt install -y nginx
```

Testen, ob er läuft:

```bash
sudo systemctl status nginx       # sollte "active (running)" zeigen
```

Wenn du jetzt `http://windfoil.example.com` aufrufst, siehst du die nginx-Standardseite.

---

## Schritt 5 — Node.js 22 + npm installieren

Ubuntu 24.04 liefert Node.js 22 direkt mit — das genügt für den Proxy:

```bash
sudo apt install -y nodejs npm
```

Versionen prüfen:

```bash
node --version      # z.B. v22.x.x
npm --version       # z.B. 10.x.x
```

> Falls du eine neuere Node-Version willst, geht das über NodeSource — für diese App aber nicht nötig.

---

## Schritt 6 — Projektverzeichnis anlegen

```bash
sudo mkdir -p /var/www/windfoil
sudo chown -R $USER:$USER /var/www/windfoil
cd /var/www/windfoil
```

---

## Schritt 7 — WindFoil-Dateien hochladen

Du brauchst auf dem Server: `app-react-local.html`, `fetch-vendor.sh`, `proxy-server.js`, `package.json`.

**Variante A — vom eigenen Rechner per SCP** (in einem Terminal auf deinem lokalen PC, nicht auf dem Server):

```bash
scp app-react-local.html fetch-vendor.sh proxy-server.js package.json deinuser@windfoil.example.com:/var/www/windfoil/
```

**Variante B — direkt auf dem Server mit nano** (Inhalt der Dateien einfügen):

```bash
cd /var/www/windfoil
nano app-react.html     # Inhalt einfügen, Strg+O speichern, Strg+X schließen
nano proxy-server.js
nano package.json
```

**Wichtig:** Verwende die **lokale** Variante `app-react-local.html` — sie lädt React/Recharts/Babel von deinem eigenen Server statt vom CDN (umgeht CORS-Blockaden im Browser).

Zuerst die Bibliotheken herunterladen (der Server erreicht das Internet, nur der Browser blockt CORS):

```bash
cd /var/www/windfoil
bash fetch-vendor.sh        # erzeugt vendor/ mit allen JS-Bibliotheken
ls -la vendor/              # sechs .js-Dateien, alle > 0 Bytes
```

Dann die lokale Variante als Startseite setzen:

```bash
cp /var/www/windfoil/app-react-local.html /var/www/windfoil/index.html
```

Prüfen, dass alles da ist:

```bash
ls -la /var/www/windfoil
# erwartet: app-react.html  index.html  package.json  proxy-server.js
```

---

## Schritt 8 — Proxy-Abhängigkeiten installieren

```bash
cd /var/www/windfoil
npm install
```

Das erzeugt den Ordner `node_modules/` mit express, node-fetch und cors.

---

## Schritt 9 — Proxy testen

```bash
export WEATHERBIT_KEY=DEIN_WEATHERBIT_KEY
node proxy-server.js
```

Du solltest sehen: `WindFoil station proxy on :8787 (key set)`

In einem **zweiten SSH-Fenster** prüfen:

```bash
curl "http://localhost:8787/api/station/health"
# erwartet: {"ok":true,"keyConfigured":true}
```

Wenn das klappt: zurück im ersten Fenster mit **Strg+C** stoppen. Gleich lassen wir ihn dauerhaft laufen.

---

## Schritt 10 — Proxy als Dienst einrichten (Auto-Start)

So läuft der Proxy automatisch und startet nach einem Reboot neu.

```bash
sudo nano /etc/systemd/system/windfoil-proxy.service
```

Diesen Inhalt einfügen (Key und ggf. User anpassen):

```ini
[Unit]
Description=WindFoil Weather Station Proxy
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/windfoil
Environment=PORT=8787
Environment=WEATHERBIT_KEY=DEIN_WEATHERBIT_KEY
ExecStart=/usr/bin/node proxy-server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Speichern (Strg+O, Enter, Strg+X). Damit `www-data` die Dateien lesen kann:

```bash
sudo chown -R www-data:www-data /var/www/windfoil
```

Dienst starten und aktivieren:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now windfoil-proxy
sudo systemctl status windfoil-proxy      # "active (running)"?
```

Nochmal testen:

```bash
curl "http://localhost:8787/api/station/health"
```

---

## Schritt 11 — nginx konfigurieren

```bash
sudo nano /etc/nginx/sites-available/windfoil
```

Diesen Inhalt einfügen (Domain anpassen):

```nginx
server {
    listen 80;
    server_name windfoil.example.com;

    root /var/www/windfoil;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

Speichern. Konfiguration aktivieren:

```bash
# Diese Seite einschalten
sudo ln -s /etc/nginx/sites-available/windfoil /etc/nginx/sites-enabled/

# Standard-Begrüßungsseite abschalten
sudo rm -f /etc/nginx/sites-enabled/default

# Syntax prüfen
sudo nginx -t

# Neu laden
sudo systemctl reload nginx
```

Jetzt sollte `http://windfoil.example.com` bereits die WindFoil-App zeigen.

---

## Schritt 12 — HTTPS aktivieren (Pflicht für GPS)

> **MyFritz-Adressen ohne eigene Domain:** Let's Encrypt/certbot funktioniert NICHT mit
> `name.myfritz.net` auf einem nicht-standard Port. Nutze dann ein **selbstsigniertes
> Zertifikat** (siehe SSL-SELFSIGNED.md). Der Browser zeigt einmalig eine Warnung,
> die du wegklickst — GPS funktioniert trotzdem. Die folgenden certbot-Schritte gelten
> nur, wenn du eine **eigene Domain** auf Port 80 erreichbar hast.

Der GPS-Standort-Button funktioniert nur über HTTPS. Certbot holt ein kostenloses Zertifikat und passt nginx automatisch an:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d windfoil.example.com
```

Certbot fragt nach deiner E-Mail und ob auf HTTPS umgeleitet werden soll — **„redirect" (Option 2) wählen**.

Auto-Erneuerung testen:

```bash
sudo certbot renew --dry-run
```

---

## Schritt 13 — Fertig & Endkontrolle

Im Browser öffnen:

```
https://windfoil.example.com
```

Prüfliste:
- ✅ Seite lädt mit Charts und Foil-Score
- ✅ GPS-Button „Mein Standort" fragt nach Erlaubnis (nur über HTTPS)
- ✅ Panel „Station ↔ Modell" zeigt **„✅ aktiv"** (statt „kein Backend")

Proxy-Endpunkt direkt testen:

```bash
curl "https://windfoil.example.com/api/station/health"
# erwartet: {"ok":true,"keyConfigured":true}
```

---

## Wartung & nützliche Befehle

**App aktualisieren** (neue `app-react.html` hochladen):
```bash
cp /var/www/windfoil/app-react.html /var/www/windfoil/index.html
# nichts neu zu starten — statische Datei
```

**Proxy neu starten** (nach Änderung an proxy-server.js):
```bash
sudo systemctl restart windfoil-proxy
```

**Proxy-Logs ansehen:**
```bash
sudo journalctl -u windfoil-proxy -f      # live mitlesen, Strg+C zum Beenden
```

**nginx-Logs:**
```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

**Weatherbit-Key ändern:**
```bash
sudo nano /etc/systemd/system/windfoil-proxy.service   # Key ersetzen
sudo systemctl daemon-reload
sudo systemctl restart windfoil-proxy
```

---

## Fehlersuche

| Symptom | Ursache & Lösung |
|---------|------------------|
| Seite nicht erreichbar | `sudo systemctl status nginx`; Firewall: `sudo ufw status` |
| GPS-Button tut nichts | Läuft nur über HTTPS — Schritt 12 prüfen |
| Panel „kein Backend erreichbar" | Proxy aus? `sudo systemctl status windfoil-proxy`. `/api/`-Weiterleitung in nginx prüfen |
| Proxy „key MISSING" | `WEATHERBIT_KEY` fehlt in der .service-Datei → eintragen, `daemon-reload`, `restart` |
| `curl .../api/station/health` schlägt fehl | `sudo journalctl -u windfoil-proxy -n 50` ansehen |
| Charts/Seite bleibt leer | Browser-Konsole (F12); CDN (unpkg.com) muss erreichbar sein |
| 502 Bad Gateway | Proxy läuft nicht oder falscher Port; Proxy-Status prüfen |
| Zertifikat-Fehler | Domain zeigt nicht auf Server-IP? DNS prüfen: `dig windfoil.example.com` |

---

## Sicherheitshinweise

- Der **Weatherbit-Key** liegt nur in der systemd-Datei auf dem Server — nie im Frontend, nie im Git-Repo.
- Port **8787 bleibt zu** (nur localhost). Nur 80/443 sind offen.
- Halte das System aktuell: `sudo apt update && sudo apt upgrade -y` regelmäßig.
- Optional: automatische Sicherheitsupdates mit `sudo apt install unattended-upgrades`.
