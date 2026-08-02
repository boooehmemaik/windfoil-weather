# DESIGN — Wing-Range-Feedback (per-Spot/-User Range-Kalibrierung)

Verbindliche Umsetzungsvorgabe (Phase 3, Opus 5). Umsetzung: Sonnet 5 (Phase 4/5).
**Keine eigenständigen Architekturentscheidungen** — bei Unklarheit STOPP + melden.

## Ziel & bestätigte Entscheidungen (User)
Der Fahrer gibt nach der Session die **geflogene Wing-Größe** und die **erlebte
Wind-Range** ein. Daraus wird die Score-Range **pro (User, Spot, Wing-Größe)**
kalibriert und mit der Harlem-Pace-Tabelle **geblendet**.
- **Blend 50/50**, **per Wing-Größe**, **pro Spot** (bestätigt).
- Exakter Wing-Größen-Match (keine Interpolation über Feedback-Größen — später).
- Vollständig **rückwärtskompatibel**: ohne Feedback identisch zum heutigen v3.10.0.

## Ist-Zustand (Kurz, verifiziert)
- Backend Feedback: `src/feedback.routes.mjs` (POST `/api/feedback`), `src/db.mjs`
  (`recalibrateSpotPlaningThreshold`, `getSpotCalibration`), Tabelle
  `spot_calibration(user_id,spot_id,planing_threshold_kt,samples,updated_at)`.
- `sessions` hat `planed, planing_wind_kt, wing_id(FK equipment), foil_id`. **Achtung:**
  Nutzer-Gear liegt im Pref `wf_gear`, NICHT in Tabelle `equipment` → `wing_id`
  ist für solche Nutzer leer. Deshalb Wing-Größe **direkt** als `wing_m2` in
  `sessions` speichern, unabhängig vom Equipment-FK.
- Frontend Scoring: `wingWindow()` (index.html, v3.10.0, siehe [[windfoil-scoring-architecture]]).
  Bei gesetztem `knownPlaneMs` → Bypass (reine Physik). Gear-Pfad `pickBestSetup`
  nutzt per-Gear `planeKn`; der alte `effPlaneMs` (aus `spot_calibration`) greift
  nur im **Nicht-Gear-Fallback** (index.html:1295, 1257/1280).
- Feedback-UI: `FeedbackModal` (index.html:816). Erfasst `planed`, `windKt`
  (Abhebe-Wind = untere Grenze), rating, match, notes. Sendet `planingWindKt`.

## 1. Datenmodell — Migration `db/migrations/005_spot_wing_calibration.sql`
```sql
-- sessions: geflogene Wing-Größe + erlebte Range (unabhängig vom equipment-FK)
ALTER TABLE sessions ADD COLUMN wing_m2       REAL;   -- geflogene Wing-Größe (m²)
ALTER TABLE sessions ADD COLUMN range_low_kt  REAL;   -- unteres Ende (i.d.R. = planing_wind_kt)
ALTER TABLE sessions ADD COLUMN range_high_kt REAL;   -- oberes Ende / "ab hier überpowert" (optional)

-- Rolling per (user, spot, wing_m2): gemittelte erlebte Range.
CREATE TABLE IF NOT EXISTS spot_wing_calibration (
    user_id       TEXT NOT NULL REFERENCES user(id)  ON DELETE CASCADE,
    spot_id       TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    wing_m2       REAL NOT NULL,
    range_low_kt  REAL,            -- AVG der range_low_kt-Samples (kann null sein)
    range_high_kt REAL,           -- AVG der range_high_kt-Samples (kann null sein)
    samples       INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, spot_id, wing_m2)
);
CREATE INDEX IF NOT EXISTS idx_spot_wing_cal_user ON spot_wing_calibration(user_id);
```

## 2. Backend — `src/db.mjs` (Header 1.0.1 → 1.1.0)
Neue Funktionen (Muster von `recalibrateSpotPlaningThreshold` spiegeln):
```js
// Rolling per (user, spot, wing_m2) aus sessions neu berechnen.
export function recalibrateSpotWingRange(userId, spotId) {
  const rows = db.prepare(`
    SELECT wing_m2,
           AVG(range_low_kt)  AS lo,
           AVG(range_high_kt) AS hi,
           COUNT(*)           AS samples
    FROM sessions
    WHERE user_id=? AND spot_id=? AND wing_m2 IS NOT NULL
      AND (range_low_kt IS NOT NULL OR range_high_kt IS NOT NULL)
    GROUP BY wing_m2`).all(userId, spotId);
  const up = db.prepare(`INSERT INTO spot_wing_calibration
      (user_id,spot_id,wing_m2,range_low_kt,range_high_kt,samples,updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,spot_id,wing_m2) DO UPDATE SET
        range_low_kt=excluded.range_low_kt, range_high_kt=excluded.range_high_kt,
        samples=excluded.samples, updated_at=excluded.updated_at`);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of rows)
      up.run(userId, spotId, r.wing_m2,
             r.lo==null?null:Math.round(r.lo*10)/10,
             r.hi==null?null:Math.round(r.hi*10)/10, r.samples, now);
  });
  tx();
  return getSpotWingCalibration(userId, spotId);
}

// Alle Wing-Ranges eines Spots als Array [{wingM2,minKn,maxKn,samples}].
export function getSpotWingCalibration(userId, spotId) {
  return db.prepare(`
    SELECT wing_m2 AS wingM2, range_low_kt AS minKn, range_high_kt AS maxKn, samples
    FROM spot_wing_calibration WHERE user_id=? AND spot_id=?`).all(userId, spotId);
}
```

## 3. Backend — `src/feedback.routes.mjs` (Header 1.0.1 → 1.1.0)
- Import zusätzlich `recalibrateSpotWingRange, getSpotWingCalibration`.
- POST `/api/feedback` Body erweitern: `wingM2`, `rangeLowKt`, `rangeHighKt`.
  - Validierung: `wingM2` optional Number in (0,20]; `rangeLowKt`/`rangeHighKt`
    optional Number in [1,60]; wenn beide gesetzt: `rangeLowKt <= rangeHighKt`
    sonst 400 `invalid_range`.
  - In `sessions` UPDATE **und** INSERT die drei Spalten mitschreiben
    (`wing_m2=COALESCE(?,wing_m2)` im UPDATE; direkte Werte im INSERT).
  - Default-Mapping: wenn `rangeLowKt` fehlt aber `planingWindKt` gesetzt →
    `range_low_kt = planingWindKt` (Abhebe-Wind = untere Range-Grenze).
  - Nach `recalibrateSpotPlaningThreshold` zusätzlich
    `recalibrateSpotWingRange(userId, spotId)` aufrufen; Ergebnis als
    `wingCalibration` in die Response.
- GET `/api/feedback/spot-calibration` und POST `/api/feedback/spot`: Response um
  `wingRanges: getSpotWingCalibration(userId, spotId)` erweitern (leeres Array bei keinem Spot).

## 4. Frontend `index.html` (v3.10.0 → **v3.11.0**)
### 4a. Scoring-Blend (im `// <<wing-scoring>>`-Block)
Neue Konstanten neben `TABLE_BLEND`:
```js
const FEEDBACK_BLEND = 0.5;        // Gewicht der Spot/Wing-Range-Kalibrierung
const FEEDBACK_MIN_SAMPLES = 1;    // ab so vielen Samples greift die Kalibrierung
```
Helfer + `wingWindow`-Erweiterung:
```js
// Fenster {min,opt,opt,max} aus einer erlebten kn-Range (opt-Band 25/75 wie Tabelle).
function rangeToWindow(minKn, maxKn) {
  const lo=knToMs(minKn), hi=knToMs(maxKn);
  return { minWind:Math.round(lo*10)/10,
           optMin:Math.round((lo+0.25*(hi-lo))*10)/10,
           optMax:Math.round((lo+0.75*(hi-lo))*10)/10,
           maxWind:Math.round(hi*10)/10 };
}
function blendWindows(a, b, w) {   // kantenweise, p=1-w
  const p=1-w;
  return { minWind:Math.round((p*a.minWind+w*b.minWind)*10)/10,
           optMin :Math.round((p*a.optMin +w*b.optMin )*10)/10,
           optMax :Math.round((p*a.optMax +w*b.optMax )*10)/10,
           maxWind:Math.round((p*a.maxWind+w*b.maxWind)*10)/10 };
}
```
`wingWindow` bekommt einen 7. Parameter `spotWingRange` (`{minKn,maxKn,samples}|null`):
```js
function wingWindow(weight, wingM2, foilCm2, skill, knownPlaneMs,
                    brandKey = DEFAULT_WING_BRAND, spotWingRange = null) {
  const phys = calcWindow(weight, wingM2, foilCm2, skill, knownPlaneMs);
  if (knownPlaneMs && knownPlaneMs > 0) return phys;   // Bypass unverändert
  const tab = wingTableWindow(weight, wingM2, brandKey);
  let base = (!tab || tab.outOfRange) ? phys : blendWindows(phys, tab, TABLE_BLEND);
  // NEU: Feedback-Layer — nur wenn genug Samples UND beide Range-Enden vorhanden.
  if (spotWingRange && spotWingRange.samples >= FEEDBACK_MIN_SAMPLES
      && spotWingRange.minKn != null && spotWingRange.maxKn != null) {
    const fb = rangeToWindow(spotWingRange.minKn, spotWingRange.maxKn);
    return blendWindows(base, fb, FEEDBACK_BLEND);
  }
  return base;
}
```
`blendWindows`/`rangeToWindow` **innerhalb** der Sentinels platzieren (vor `wingWindow`).
Bestehende `calcWindow`-interne Blend-Zeilen dürfen `blendWindows` nutzen (optional, nur wenn sauber).

### 4b. Call-Sites verdrahten
- `pickBestSetup(gearList, weight, skill, windMs, wingRanges=null)` (Signatur erweitern):
  je Gear `const swr = wingRanges ? wingRanges[String(parseFloat(g.wing))] : null;`
  an `wingWindow(...· , DEFAULT_WING_BRAND, swr)` durchreichen.
- index.html:1253 `pickBestSetup(gear, rider.weight, rider.skill, midW, spotWingMap)`.
- Fallback 1257/1280: `wingWindow(rider.weight, rider.wingSize, …, effPlaneMs, DEFAULT_WING_BRAND, spotWingMap?.[String(rider.wingSize)])`.
- `spotWingMap`: aus `spotCal.wingRanges` gebaut, `{ [String(wingM2)]: {minKn,maxKn,samples} }`.

### 4c. State + Fetch
- `spotCal`-State (index.html:999/1007): die `/spot-calibration`-Response um `wingRanges`
  erweitert übernehmen; `spotWingMap` daraus memoisieren.

### 4d. `FeedbackModal` erweitern (index.html:816+)
- Neuer State: `wingM2` (Default = geflogener/empf. Wing; Auswahl aus distinct
  `gear`-Wing-Größen, sonst Stepper), `windTopKt` (oberes Ende, optional; Stepper wie `windKt`).
- Label: „Wind beim Abheben" = untere Grenze (bestehend), NEU „Wing-Größe" (Auswahl)
  und „Oberes Ende (überpowert ab)" — optional, nur bei `planed===true`.
- `submit()` Body ergänzen: `wingM2, rangeLowKt: windKt, rangeHighKt: windTopKt||null`.
- Erfolgs-Ansicht: wenn `d.wingCalibration` für die Größe vorhanden, kurzen Hinweis
  „Range für {wingM2} m² an {loc.name} kalibriert: {min}–{max} kn ({samples})".

## 5. Versionierung
- `index.html` v3.10.0 → **v3.11.0** (4 Header-Stellen wie gehabt).
- `src/db.mjs`, `src/feedback.routes.mjs`: File-Version 1.0.1 → **1.1.0**, App target v3.11.0.
- Neu: `db/migrations/005_spot_wing_calibration.sql` (Header wie 002).
- `VERSIONS.md`: `## v3.11.0`-Block (deutsch, Datum today).

## 6. TESTPLAN (Phase 5)
### 6a. Frontend-Scoring — in `wing-scoring.test.mjs` (vm gegen echten Code) ergänzen
1. **Kein Feedback** (`spotWingRange=null`) → `wingWindow(...)` deep-equal zum
   v3.10.0-Verhalten (Regression: identisch zur reinen phys/tab-Blend-Ausgabe).
2. **Feedback-Blend 4 m²/Talamone:** `spotWingRange={minKn:25,maxKn:30,samples:1}`,
   93 kg → Ergebnis-`minWind`/`maxWind` = `blendWindows(base, rangeToWindow(25,30), 0.5)`;
   numerisch prüfen (minWind höher als ohne Feedback, Richtung 25 kn).
3. **Samples-Gate:** `samples=0` → kein Blend (== base). `samples=1` → Blend aktiv.
4. **Nur eine Grenze vorhanden** (`maxKn=null`) → kein Range-Blend (Guard greift).
5. **Bypass-Vorrang:** `knownPlaneMs>0` gesetzt → Feedback-Layer wird ignoriert
   (deep-equal zu `calcWindow`).
6. `blendWindows`/`rangeToWindow` Einheiten korrekt (kn→m/s), opt-Band 25/75.
### 6b. Backend-Recalc — neuer Test `feedback-wing-range.test.mjs` (node:test)
- In-Memory-DB (better-sqlite3 `:memory:`), Migrations 001/002/005 laden, minimal
  user+spot seeden, 2–3 sessions mit `wing_m2/range_low_kt/range_high_kt` INSERT,
  `recalibrateSpotWingRange` → `spot_wing_calibration` enthält gemittelte Range je
  Größe; `getSpotWingCalibration` liefert das Array. Grenzfälle: nur low, nur high.
### 6c. Health
`node --test wing-scoring.test.mjs feedback-wing-range.test.mjs` grün; `node -c proxy-server.js`.
Migration lokal gegen eine **Kopie** der DB testen, nicht gegen die Live-DB.

## Offene Annahmen (Phase 6 bestätigen)
- **B1** `FEEDBACK_BLEND=0.5`, `FEEDBACK_MIN_SAMPLES=1` (tunbar).
- **B2** Feedback-Layer liegt ÜBER dem phys/tab-Blend (zieht das Endfenster 50 %
  Richtung erlebter Range). Alternative (Feedback ersetzt Tabelle vor phys-Blend)
  bewusst verworfen — additive Schicht ist rückwärtskompatibel & testbar.
- **B3** Range-Blend nur wenn **beide** Enden vorhanden; nur-Abhebe-Wind läuft
  weiter über die bestehende `spot_calibration`/`effPlaneMs`-Logik (Nicht-Gear-Fallback).
- **B4** Kein Deploy ohne Freigabe; Migration additiv (nur ADD COLUMN / neue Tabelle).
