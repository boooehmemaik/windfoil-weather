# WindFoil Weather Intelligence

Ein Wetter-Dashboard, das Prognosedaten in eine konkrete Wingfoil-Empfehlung für deinen Spot übersetzt. Aktuelle Version: **v2.2.0**.

Standard-Spot: **Navarino / Gialova** (Griechenland).

---

## Was die App macht

Du gibst dein Material ein (Gewicht, Wing, Foil, Skill), die App sagt dir, ob und wann die Bedingungen an den nächsten Tagen zum Foilen passen.

- **4-Tages-Prognose**, stündlich, über die Open-Meteo API — mit automatischem Demo-Fallback, falls keine Verbindung besteht
- **Foil-Score (0–100)** pro Tag, berechnet aus deinem persönlichen Setup. Daraus ergibt sich dein Windfenster: Abheben → Optimal → Overpowered → Maximum
- **Thermik-Analyse** inklusive lokalem Meeresbrise-Modell für die Navarino-Bucht (W-SW-Nachmittagsbrise)
- **Diagramme**: Wind & Böen, Windrichtung, Temperatur, Luftdruck, Thermik-Index, historischer ERA5-Vergleich, Foil-Fenster
- **Equipment-Empfehlung** im Klartext (z.B. „kleineren Wing erwägen", Böenwarnung)
- **Einheiten** umschaltbar: m/s · Knoten · Beaufort
- **Rider-Profil speichern** + **Equipment-Liste** (mehrere Wings/Foils mit eigener Abhebe-Schwelle); die App wählt automatisch das beste Setup für den Tag
- **Standortwahl** per GPS (aktueller Standort), Voreinstellung, Google-Maps-Link oder Koordinaten
- **Externe Wetterstationen** als URL hinzufügbar

---

## Bewertungslogik: Station ↔ Modell ↔ Rider

Der Foil-Score entsteht aus drei Ebenen:

1. **Wettermodell** (Open-Meteo) liefert die Prognose für die Region.
2. **Echte Wetterstation** (Weatherbit, via Proxy) liefert aktuelle + historische Messwerte am Spot.
3. **Rider-Angaben** (Gewicht, Wing, Foil, Skill) definieren dein persönliches Windfenster.

Die App vergleicht **Station gegen Modell** und berechnet daraus einen **Vertrauens-Score (0–100 %)**:

- Stimmen Station und Modell überein → hohe Sicherheit → Foil-Score bleibt wie berechnet.
- Weichen sie stark ab → geringe Sicherheit → der Foil-Score (für heute) wird Richtung neutral (50) gedämpft, weil die Prognose dann unzuverlässig ist.

Drei Abweichungen fließen gewichtet ein: aktueller Wind (45 %), historischer Bias (35 %), aktuelle Windrichtung (20 %).

---

## Bedienung

1. **Rider-Profil** oben ausfüllen: Gewicht (kg), Wing (m²), Foil-Frontflügel (cm²), Skill-Level
2. **ANALYSE STARTEN** klicken
3. Über die **Tages-Tabs** (Heute / Morgen / …) zwischen den Tagen wechseln
4. **Einheit** oben rechts umschalten (m/s · kn · BF)
5. **Ort ändern** für einen anderen Spot:
   - *Mein Standort*: per GPS automatisch ermitteln (Browser fragt nach Erlaubnis)
   - *Voreinstellungen*: Navarino, Pylos, Sparti, Korinthia
   - *Maps-Link*: Google-Maps-URL einfügen — Koordinaten werden automatisch erkannt
6. **Externe Wetterstation** unten per URL ergänzen

### Den Foil-Score lesen

| Score  | Bedeutung            |
|--------|----------------------|
| 75–100 | ✅ Gute Bedingungen  |
| 45–74  | ⚠️ Brauchbar          |
| 0–44   | ❌ Eher ungeeignet    |

---

## Projektstruktur

Es gibt zwei Varianten desselben Systems.

### 1. Standalone-Webseite (für deinen Host)

```
windfoil-weather/
├── index.html          Haupt-Dashboard
├── css/
│   └── style.css       Maritime-Industrial Design
└── js/
    ├── api.js          Open-Meteo API (Forecast + ERA5 Historical)
    ├── thermik.js      Thermik/Konvektion + Meeresbrise-Modell
    ├── foilscore.js    Rider-spezifische Foil-Score-Berechnung
    ├── charts.js       Chart.js-Visualisierungen
    ├── stationsource.js Echte Stationsdaten + Vertrauens-Score
    └── app.js          Hauptcontroller & UI-Logik

proxy-server.js         Sicherer Backend-Proxy (hält den API-Key)
```

### 2. Self-contained React-Komponente

```
windfoil-weather/
└── WindFoilApp.jsx     Komplettes Dashboard in einer Datei
```

Diese Variante enthält die gesamte Logik (API, Thermik, Foil-Score, Charts, Demo-Daten) inline und nutzt `recharts` für die Diagramme.

---

## Echte Stationsdaten: Backend einrichten (erforderlich für Vertrauens-Score)

Der Weatherbit-API-Key darf **niemals im Browser** stehen. Deshalb läuft ein kleiner Proxy auf deinem Host, der den Key hält und nur zwei sichere Endpunkte freigibt.

```bash
# 1. Abhängigkeiten
npm install express node-fetch@2 cors

# 2. API-Key setzen (von weatherbit.io)
export WEATHERBIT_KEY=dein_key_hier

# 3. Proxy starten
node proxy-server.js        # läuft auf Port 8787
```

Das Frontend ruft nur `/api/station/current` und `/api/station/history` auf deinem eigenen Host auf — gleiche Domain, kein CORS, kein sichtbarer Key. Stelle die Webseite und den Proxy hinter denselben Reverse-Proxy (nginx, Caddy), damit `/api/*` erreichbar ist.

**Anbieter wechseln** (Windy / Weather Underground): Nur `proxy-server.js` (URLs + Normalisierung) anpassen. Frontend und JSON-Vertrag bleiben gleich.

**Ohne Backend**: Die App funktioniert weiter — dann fehlt nur der Vertrauens-Score, und die Bewertung basiert auf Modell + Rider-Angaben.

---

## Deployment

### Standalone-Webseite

Den kompletten Ordner per FTP/SFTP auf deinen Host laden. Keine Server-Konfiguration nötig — reines HTML/CSS/JS. Die App ruft Open-Meteo direkt aus dem Browser auf.

### React-Komponente

`WindFoilApp.jsx` in ein React-Projekt einbinden. Voraussetzung: `recharts` als Abhängigkeit.

```bash
npm install recharts
```

---

## Datenquellen

- **Open-Meteo Forecast API** — stündliche Prognose (kein API-Key nötig)
- **Open-Meteo ERA5 / ECMWF Archive** — historischer Vergleich der letzten 7 Tage
- **Open-Meteo Geocoding API** — Ortsname zur GPS-Position (Reverse-Geocoding)
- **Weatherbit API** — echte Stationsdaten (aktuell + historisch) für den Station-Modell-Abgleich (API-Key + Proxy erforderlich)
- **Rider-Input** — dein Setup für die personalisierte Berechnung

---

## Technische Hinweise

- **Einheiten intern**: Alle Berechnungen laufen in m/s; die Umrechnung in Knoten oder Beaufort erfolgt nur in der Anzeige, damit die Algorithmen präzise bleiben.
- **Zeitzonen**: Die Tageszuordnung (Heute / Morgen / …) wird am ersten Zeitstempel der API-Daten verankert, nicht an der Browser-Uhr. Dadurch stimmen die Tage für Nutzer in jeder Zeitzone.
- **Demo-Modus**: Schlägt eine API fehl, lädt die App realistische Beispieldaten für den Spot. Der Status (Live / Demo) wird oben im Header angezeigt.
- **Google-Maps-Kurzlinks** (`maps.app.goo.gl`) können im Browser nicht aufgelöst werden — stattdessen die lange URL aus der Adresszeile kopieren.
- **GPS-Standort**: Die Browser-Geolocation funktioniert nur über **HTTPS** (bzw. `localhost`). Auf deinem Host also ein SSL-Zertifikat einrichten, sonst bleibt der Button ohne Funktion. Der Nutzer muss den Standortzugriff einmalig erlauben.

---

## Versionshistorie

| Version | Änderung                                                        |
|---------|-----------------------------------------------------------------|
| v1.0.0  | Erstes Dashboard mit Forecast, Thermik, Foil-Score, Charts     |
| v1.1.0  | Robustes API-Fallback, Demo-Modus, unabhängige Datenabrufe     |
| v1.2.0  | Windgeschwindigkeit umschaltbar: m/s · Knoten · Beaufort       |
| v1.3.0  | Zeitzonen-Bug bei der Stunden-/Datumsanzeige behoben           |
| v1.4.0  | Tagesgrenzen aus echten Kalenderdaten berechnet                |
| v1.5.0  | Demo-Daten mit korrekten lokalen Zeitstempeln neu aufgebaut    |
| v1.6.0  | Tageszuordnung an API-Daten verankert (zeitzonenunabhängig)    |
| v1.7.0  | Manuelle Eingabe per Google-Maps-Link                          |
| v1.8.0  | GPS-Standort per Browser-Geolocation + Reverse-Geocoding       |
| v1.9.0  | Automatische lokale Stationen im Umkreis (Modell-Gitterpunkte) |
| v2.0.0  | Echter Station-Modell-Abgleich + Vertrauens-Score + Proxy      |
| v2.1.0  | Optionale Kalibrierung: eigene Abhebe-Schwelle (kn) ueberschreibt Formel |
| v2.2.0  | Rider-Profil speicherbar + Equipment-Liste mit automatischer Setup-Wahl |
# windfoil-weather
