# DESIGN — Obs-basiertes Feedback (Wing + Zeit statt geschätzter Knoten)

Verbindliche Umsetzungsvorgabe (Phase 3, Opus). Umsetzung: Sonnet. Danach System-Test
+ Opus-Verifikation. **Keine eigenständigen Architekturentscheidungen.**

## Ziel & bestätigte Entscheidungen
Der Fahrer gibt im Feedback **nur Wing-Größe + Zeitfenster** an. Die **echte Wind-Range**
wird aus **serverseitig geloggten Stationswerten** für dieses Fenster abgeleitet — keine
geschätzten Knoten mehr. (User bestätigt: Server-Logging; nur Wing+Zeit.)

## Ist-Zustand (verifiziert)
- KEIN Server-Obs-Log, kein Cron. `proxy-server.js` proxied Stationen on-demand
  (`LIVE_STATIONS`=Talamone, `MEASURED_STATIONS`=Torbole/Ulcinj/LGPZ; `findLiveStation`/
  `findMeasuredStation` matchen per Koordinaten).
- Feedback heute: `src/feedback.routes.mjs` POST nimmt `wingM2/planingWindKt/rangeLowKt/
  rangeHighKt` (rider-geschätzt) → `sessions` → `recalibrateSpotWingRange` (`src/db.mjs`)
  → `spot_wing_calibration(user,spot,wing_m2,range_low_kt,range_high_kt,samples)`.
- `wingWindow`-Blend (index.html) konsumiert `spot_wing_calibration` unverändert — **bleibt**.

## 1. Migration `db/migrations/006_station_obs.sql`
```sql
-- Rolling Log echter Stationswerte (vom Server-Poller befüllt).
CREATE TABLE IF NOT EXISTS station_obs (
    station_key TEXT NOT NULL,        -- stabiler Schlüssel der Spezial-Station (z.B. "talamone","LGPZ")
    ts          TEXT NOT NULL,        -- ISO-8601 UTC des Messzeitpunkts
    wind_ms     REAL,                 -- Grundwind (m/s)
    gust_ms     REAL,                 -- Böe (m/s)
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    PRIMARY KEY (station_key, ts)
);
CREATE INDEX IF NOT EXISTS idx_station_obs_ts ON station_obs(ts);
```
Additiv, keine Änderung an bestehenden Tabellen. `sessions.wing_m2/range_low_kt/
range_high_kt` (Migration 005) bleiben — werden jetzt **abgeleitet** befüllt.

## 2. Server-Poller (`proxy-server.js`)
- `setInterval` alle **10 min** (`OBS_POLL_MS = 600000`). Beim Start einmal sofort.
- Für jede Station in `LIVE_STATIONS` ∪ `MEASURED_STATIONS`: die vorhandene interne
  „aktueller Wert"-Logik nutzen (dieselbe wie `/api/station/live` bzw. current) →
  `{wind_ms, gust_ms}`. `INSERT OR IGNORE INTO station_obs` mit `ts = new Date().toISOString()`.
  `station_key` = `s.key` (live) bzw. `s.wc||s.icao||s.station` (measured), stabil.
- Fehler pro Station abfangen (kein Crash). Kein Poll, wenn `sensorOk===false`/kein Wert.
- **Prune:** bei jedem Lauf `DELETE FROM station_obs WHERE ts < now-14d`.
- DB-Zugriff über `src/db.mjs` (bereits per Bridge geladen) oder eine schlanke
  better-sqlite3-Prepared-Statement-Schicht — an bestehende Integration anpassen (Repo lesen!).

## 3. `src/db.mjs` (Header 1.1.0 → 1.2.0)
```js
// Repräsentative Wind-Range aus geloggten Obs im Zeitfenster [startIso,endIso]
// für die Station nahe (lat,lon). low = min Grundwind, high = max Böe (m/s) → kn.
export function getObservedWindRange(stationKey, startIso, endIso) {
  const rows = db.prepare(`SELECT wind_ms, gust_ms FROM station_obs
     WHERE station_key=? AND ts>=? AND ts<=?`).all(stationKey, startIso, endIso);
  if (!rows.length) return null;
  const winds = rows.map(r=>r.wind_ms).filter(v=>v!=null);
  const gusts = rows.map(r=>r.gust_ms).filter(v=>v!=null);
  if (!winds.length) return null;
  const KN = 1.94384;
  return {
    lowKn:  Math.round(Math.min(...winds) * KN * 10) / 10,   // leichtester Grundwind
    highKn: Math.round(Math.max(...(gusts.length?gusts:winds)) * KN * 10) / 10, // stärkste Böe
    samples: rows.length,
  };
}
```
`recalibrateSpotWingRange`/`getSpotWingCalibration` bleiben **unverändert** (sie aggregieren
weiter `sessions.range_low_kt/range_high_kt` je Wing). Neu ist nur, WOHER diese Werte kommen.
Der Station-Key zu einem Spot: über die vorhandene Koordinaten-Zuordnung (eine kleine
Hilfsfunktion, die `findLiveStation`/`findMeasuredStation`-Logik spiegelt, oder ein neuer
Backend-Endpoint liefert den `station_key` zu lat/lon).

## 4. `src/feedback.routes.mjs` (Header 1.1.0 → 1.2.0)
- POST `/api/feedback` Body neu: `{ spotId, wingM2, startedAt, endedAt, rating?, conditionsMatched?, notes? }`.
  **Entfällt:** `planingWindKt/rangeLowKt/rangeHighKt` (rider-Knoten).
- Serverseitig: Station-Key zum Spot (aus `spots.latitude/longitude`) bestimmen →
  `getObservedWindRange(stationKey, startedAt, endedAt)`.
  - Treffer → `sessions.wing_m2 = wingM2`, `range_low_kt = obs.lowKn`, `range_high_kt = obs.highKn`,
    `planing_wind_kt = obs.lowKn` (Kompat. für alte Planing-Kalibrierung).
  - Kein Obs (Station down / Spot ohne Station) → Session speichern, aber Range-Felder null
    (keine Kalibrierung; Response-Flag `observed:false`).
- Danach `recalibrateSpotWingRange` + `recalibrateSpotPlaningThreshold` wie gehabt.
  Response: `{ ok, sessionId, observed, wingCalibration }`.
- Validierung: `wingM2` Number in (0,20]; `startedAt`/`endedAt` ISO, `start<end`, Fenster ≤ 24 h,
  „nur heute"-Gate wie bisher (spot-lokaler Tag).

## 5. Frontend `index.html` — `FeedbackModal` vereinfachen (v3.16.0 → **v3.17.0**)
- **Entfernen:** Knoten-Stepper „Wind beim Abheben" + „oberes Ende". `windKt/windTopKt`-State weg.
- **Neu/behalten:** Wing-Größen-Auswahl (aus `gear`), **Zeitfenster** von–bis
  (zwei `<input type="time">`, Default z. B. `now-2h`…`now`, spot-lokal).
- `submit()` Body: `{ spotId, wingM2, startedAt, endedAt, rating, conditionsMatched, notes }`
  (startedAt/endedAt aus dem gewählten Fenster als ISO). Keine kn mehr senden.
- Erfolgs-Ansicht: wenn `d.observed`, „Aus echten Stationswerten: {wing} m² bei ~{low}–{high} kn
  kalibriert"; sonst Hinweis „keine Stationsdaten für dieses Fenster".
- `planed`-Frage kann bleiben (ein Tap, optional) — **keine** kn-Eingabe mehr.
- 4× Versions-Header v3.16.0 → v3.17.0.

## 6. Versionierung & VERSIONS.md
- `db/migrations/006_station_obs.sql` (neu), `src/db.mjs` 1.2.0, `src/feedback.routes.mjs` 1.2.0,
  `proxy-server.js` (Poller; Datei hat Header — Patch/Minor je Konvention), `index.html` v3.16.0.
- `VERSIONS.md` `## v3.17.0`-Block (deutsch, Datum today).

## 7. TESTPLAN (Phase 5)
- **Backend** `feedback-obs.test.mjs` (node:test, better-sqlite3 `:memory:`, Migrations 001–006):
  1. `station_obs` seeden (mehrere ts im Fenster mit variierendem wind/gust) →
     `getObservedWindRange` liefert low=min(wind), high=max(gust), samples=n. Grenzfälle:
     kein Obs → null; nur wind (kein gust) → high aus wind.
  2. Feedback-Route (oder ihre Kernlogik) mit wing+Fenster → `sessions` bekommt abgeleitete
     range_low/high; `recalibrateSpotWingRange` erzeugt `spot_wing_calibration`.
  3. Kein-Obs-Fall → `observed:false`, keine Kalibrierung, kein Crash.
- **Poller**: Insert-Idempotenz (`INSERT OR IGNORE`), Prune-Query korrekt (nur >14d), Fehler
  einer Station bricht die Schleife nicht.
- **Frontend**: `wingWindow`-Blend unverändert (Regression, wing-scoring.test.mjs bleibt grün).
- **Migration**: Trockenlauf gegen DB-**Kopie** (`006` applied, Tabelle + Index da).
- Alle Suites grün; `node -c proxy-server.js`; inline-JSX via esbuild syntax-validiert.

## Offene Annahmen (Phase 6)
- **G1** Poll-Intervall 10 min, Retention 14 Tage (tunbar).
- **G2** Range aus Obs: low=min Grundwind, high=max Böe im Fenster (Böe als Obergrenze, weil
  Überpowern böengetrieben ist). Alternative (max Grundwind) bewusst verworfen.
- **G3** Poller läuft im `proxy-server.js`-Prozess (kein separater Cron) — einfachster Weg,
  überlebt via systemd-Restart. Bei Multi-Instanz später externisieren.
- **G4** Nur die bekannten Spezial-Stationen werden geloggt; Spots ohne Station → `observed:false`.
- **G5** `planed`/`rating`/`notes` bleiben optional; die kn-Schätzung entfällt komplett.
