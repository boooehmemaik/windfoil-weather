# DEPLOYMENT — WindFoil Weather Intelligence v2.1.0

So bringst du die App auf deinen eigenen Host. Es gibt zwei Teile:

1. **Frontend** — eine statische Webseite (kein Build nötig).
2. **Backend-Proxy** — ein kleiner Node-Dienst, der deinen Weatherbit-API-Key geheim hält. Nur nötig, wenn du den Station-Modell-Abgleich / Vertrauens-Score nutzen willst.

Du kannst mit Teil 1 allein starten — die App läuft dann mit Modell- + Rider-Daten. Den Vertrauens-Score schaltest du mit Teil 2 frei.

---

## Welche Datei ist das Frontend?

Nimm **`app-react.html`** — das ist die aktuelle, vollständige App (v2.1.0) als eine einzige Datei. Sie lädt React, Recharts und Babel über ein CDN; du brauchst kein npm und kein Build-Tool fürs Frontend.

> Die Dateien `index.html` + `js/` + `css/` sind die ältere Standalone-Variante (v1.0) und werden **nicht** benötigt. Du kannst sie ignorieren oder löschen.

---

## Teil 1 — Frontend hochladen (Minimum)

### Variante A: Einfacher Webspace (FTP/SFTP, kein eigener Server)

1. Lade `app-react.html` auf deinen Webspace.
2. Benenne sie in `index.html` um, damit sie als Startseite erscheint.
3. Fertig — Seite im Browser aufrufen.

**Wichtig:** Damit GPS („Mein Standort") funktioniert, muss die Seite über **HTTPS** ausgeliefert werden. Die meisten Hoster bieten kostenloses SSL (Let's Encrypt) per Klick im Control-Panel.

In diesem Modus zeigt das Panel „Station ↔ Modell" den Hinweis *„kein Stations-Backend erreichbar"* — das ist normal ohne Teil 2.

### Variante B: Eigener Linux-Server (root/VPS)

1. Lege das Web-Verzeichnis an und kopiere die Datei dorthin:
   ```bash
   sudo mkdir -p /var/www/windfoil
   sudo cp app-react.html /var/www/windfoil/index.html
   ```
2. Weiter mit Teil 2 (Proxy) und Teil 3 (nginx + HTTPS).

---

## Teil 2 — Backend-Proxy (für echten Station-Abgleich)

Der Proxy hält den API-Key serverseitig. **Den Key niemals ins Frontend schreiben** — er wäre sonst für jeden Besucher sichtbar.

### 2.1 Weatherbit-Key besorgen
Auf [weatherbit.io](https://www.weatherbit.io) registrieren und den API-Key kopieren.

### 2.2 Node installieren (falls nicht vorhanden)
```bash
node --version   # sollte >= 18 sein
# falls nicht:  https://nodejs.org  oder per Paketmanager
```

### 2.3 Proxy einrichten
```bash
cd /var/www/windfoil
# proxy-server.js und package.json hierher kopieren, dann:
npm install
```

### 2.4 Testlauf
```bash
export WEATHERBIT_KEY=dein_key_hier
node proxy-server.js
# → "WindFoil station proxy on :8787 (key set)"
```
In einem zweiten Terminal prüfen:
```bash
curl "http://localhost:8787/api/station/health"
# → {"ok":true,"keyConfigured":true}
curl "http://localhost:8787/api/station/current?lat=36.9833&lon=21.6667"
# → echte Stationsdaten als JSON
```

### 2.5 Dauerhaft laufen lassen (systemd)
Damit der Proxy nach Neustart automatisch startet:
```bash
sudo cp windfoil-proxy.service /etc/systemd/system/
sudo nano /etc/systemd/system/windfoil-proxy.service   # WEATHERBIT_KEY eintragen
sudo systemctl daemon-reload
sudo systemctl enable --now windfoil-proxy
sudo systemctl status windfoil-proxy                    # läuft?
```

---

## Teil 3 — Alles zusammen über HTTPS (nginx)

Frontend und Proxy hinter denselben Webserver hängen, damit `/api/*` auf
derselben Domain liegt (kein CORS, kein sichtbarer Key).

### 3.1 nginx-Konfiguration
```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/windfoil
sudo nano /etc/nginx/sites-available/windfoil   # server_name + Pfade anpassen
sudo ln -s /etc/nginx/sites-available/windfoil /etc/nginx/sites-enabled/
sudo nginx -t          # Syntax prüfen
sudo systemctl reload nginx
```

### 3.2 Kostenloses SSL-Zertifikat (Let's Encrypt)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d windfoil.example.com
```
Certbot trägt die Zertifikatspfade automatisch in die nginx-Config ein und
richtet die Auto-Erneuerung ein.

### 3.3 Fertig
- `https://windfoil.example.com` → die App
- `https://windfoil.example.com/api/station/health` → Proxy erreichbar

Sobald der Proxy läuft, schaltet das Panel „Station ↔ Modell" automatisch auf
**„✅ aktiv"** und der Vertrauens-Score fließt in den Foil-Score ein.

---

## Dateiübersicht

| Datei                    | Zweck                                            | Auf den Host? |
|--------------------------|--------------------------------------------------|---------------|
| `app-react.html`         | **Das Frontend** (als `index.html` ablegen)      | ✅ ja         |
| `proxy-server.js`        | Backend-Proxy (hält den API-Key)                 | ✅ für Teil 2 |
| `package.json`           | npm-Abhängigkeiten des Proxys                    | ✅ für Teil 2 |
| `windfoil-proxy.service` | systemd-Dienst (Auto-Start)                      | ✅ optional   |
| `nginx.conf.example`     | Webserver-Konfiguration                          | ✅ Variante B |
| `WindFoilApp.jsx`        | React-Quellcode (Referenz / für eigenen Build)   | ⬜ nein       |
| `index.html`,`js/`,`css/`| Alte v1.0-Variante                               | ⬜ nein       |
| `README.md`              | Funktions- & Bedienungsdoku                      | ⬜ nein       |

---

## Schnellster Weg (nur Frontend, ohne Proxy)

Wenn du es erst einmal nur laufen sehen willst:

1. `app-react.html` als `index.html` auf den Webspace laden.
2. HTTPS im Hoster-Panel aktivieren.
3. Aufrufen — läuft mit Modell- + Rider-Bewertung. Vertrauens-Score kommt später mit dem Proxy dazu.

---

## Fehlersuche

- **GPS-Button reagiert nicht** → Seite läuft über HTTP statt HTTPS. SSL aktivieren.
- **Panel zeigt „kein Stations-Backend"** → Proxy läuft nicht oder `/api/` wird nicht weitergeleitet. `curl .../api/station/health` prüfen.
- **Proxy: „key MISSING"** → `WEATHERBIT_KEY` nicht gesetzt (in der systemd-Datei oder per `export`).
- **Charts/Seite bleibt leer** → Browser-Konsole (F12) öffnen; meist eine blockierte CDN-Verbindung. CDNs (unpkg.com) müssen erreichbar sein.
- **API-Kontingent erschöpft** → Der Proxy cached bereits (5 Min für aktuell, 1 h für Historie). Weatherbit-Plan ggf. anheben.
