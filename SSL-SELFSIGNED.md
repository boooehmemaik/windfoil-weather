# Selbstsigniertes HTTPS-Zertifikat (für MyFritz / private Hosts)

Wenn du eine `name.myfritz.net`-Adresse auf einem eigenen Port (z.B. 8505) nutzt,
kann Let's Encrypt kein Zertifikat ausstellen. Lösung: ein selbstsigniertes
Zertifikat. Der Browser zeigt einmalig eine Warnung, die du wegklickst — HTTPS
und der GPS-Button funktionieren danach voll.

Alle Befehle auf dem Server.

## 1. Zertifikat erzeugen (10 Jahre gültig)

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/windfoil.key \
  -out /etc/nginx/ssl/windfoil.crt \
  -subj "/CN=ik3acymjxllpensn.myfritz.net"
```

(CN durch deine MyFritz-Adresse ersetzen.)

## 2. nginx-Konfiguration

```bash
sudo nano /etc/nginx/sites-available/windfoil
```

Inhalt (Domain anpassen):

```nginx
server {
    listen 443 ssl;
    server_name ik3acymjxllpensn.myfritz.net;

    ssl_certificate     /etc/nginx/ssl/windfoil.crt;
    ssl_certificate_key /etc/nginx/ssl/windfoil.key;

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

## 3. Aktivieren

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 4. Fritzbox-Portfreigabe anpassen

Da nginx jetzt auf Port **443** lauscht, muss die Freigabe darauf zeigen:

- Port an Gerät: **443** (bis Port: 443)
- Port extern: 8505 (bleibt)
- Protokoll: TCP

## 5. Aufrufen

Im Browser (mit `https://` davor, am besten Inkognito-Fenster):

```
https://ik3acymjxllpensn.myfritz.net:8505
```

Warnung „Verbindung nicht privat" → **Erweitert → Weiter zu …** → die App erscheint.

## Test von der Server-Konsole

```bash
curl -kI https://localhost:443
# erwartet: HTTP/1.1 200 OK
```
