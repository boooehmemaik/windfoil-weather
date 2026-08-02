# DESIGN — Measured-Station-Korrektur (Phase 3, Opus 5)

Verbindliche Umsetzungsvorgabe. Umsetzung: Sonnet 5 (Phase 4/5). **Keine
eigenständigen Architekturentscheidungen** — bei echter Unklarheit STOPP + melden.

## Ziel
Wie der Live-Boost (v3.12.0), aber für Spots mit **measured-Station** (volle
Tagesreihe echter Beobachtungen): Torbole (addicted, ~0 km), Ulcinj (neverin),
Vasiliki→Aktion/Preveza (METAR, ~35 km). Statt aus einem Punkt zu extrapolieren
wird **pro Stunde** gegen die reale Messreihe korrigiert.

## Kernprinzipien (bewusst anders als der Live-Boost)
1. **Pro-Stunde-Korrektur** der bereits **beobachteten** Stunden — keine
   Vorwärts-Extrapolation (die measured-Reihe hat für Zukunftsstunden `null`).
   Ehrlicher als der Live-Boost: wir korrigieren nur, was gemessen wurde.
2. **Raise-only:** nur anheben, wenn die Station MEHR misst als das Modell. Nie
   kappen — sonst würde eine ferne Proxy-Station (LGPZ 35 km, „kein Bucht-Wert")
   einen echt guten Bucht-Thermik-Forecast fälschlich herunterziehen.
3. **Distanzgewichtet:** nahe Station (Torbole 0 km) = starke Korrektur, ferne
   (LGPZ 35 km) = sanfter Nudge. Respektiert die bestehende „fern = Proxy"-Philosophie.
4. **Frontend-only, non-mutating.** `measured` wird bereits gefetcht (index.html
   `setMeasured`, ~1360–1372, für den Chart-Overlay) → nur ins Scoring ziehen.

## 1. Neue reine Funktion (eigener Sentinel-Block, direkt nach `// <</live-boost>>`)
```js
// <<measured-correction>>
// Distanzgewichtete, RAISE-ONLY Pro-Stunde-Korrektur des Tages-Winds an der
// echten Messreihe (measured-Station). Nahe Station = starkes Gewicht, ferne =
// schwach (Proxy). Non-mutating; nur wo die Station mehr misst als das Modell.
const STATION_TRUST_AT_SPOT = 0.8;   // Blend-Gewicht bei ~0 km Entfernung
const STATION_MAX_KM        = 50;    // ab hier kein Vertrauen mehr (Gewicht 0)
function measuredWeight(km) {
  if (km == null) return STATION_TRUST_AT_SPOT;
  return Math.max(0, STATION_TRUST_AT_SPOT * (1 - Math.min(km, STATION_MAX_KM) / STATION_MAX_KM));
}
// wins/gust: 24h-Slices (m/s) des ANGEZEIGTEN Tages. measured: State-Objekt vom
// /api/station/measured-Feed. activeDateStr: 'YYYY-MM-DD' des angezeigten Tages.
function applyMeasuredStationCorrection(wins, gust, measured, activeDateStr) {
  const none = { wins, gust, applied: false, station: null, km: null, weight: 0 };
  if (!measured || !measured.ok || !measured.hourly || measured.date !== activeDateStr) return none;
  const mw = measured.hourly.wind || [], mg = measured.hourly.gust || [];
  const w = measuredWeight(measured.km);
  if (w <= 0) return none;
  const bw = wins.slice(), bg = gust ? gust.slice() : gust;
  let applied = false;
  for (let h = 0; h < bw.length; h++) {
    if (mw[h] != null && bw[h] != null && mw[h] > bw[h]) {
      bw[h] = Math.round((bw[h] + (mw[h] - bw[h]) * w) * 100) / 100; applied = true;
    }
    if (bg && mg[h] != null && bg[h] != null && mg[h] > bg[h]) {
      bg[h] = Math.round((bg[h] + (mg[h] - bg[h]) * w) * 100) / 100;
    }
  }
  return applied
    ? { wins: bw, gust: bg, applied: true, station: measured.label || measured.source || "Station",
        km: measured.km ?? null, weight: Math.round(w * 100) / 100 }
    : none;
}
// <</measured-correction>>
```

## 2. Verdrahtung im `dayData`-Memo (~index.html:1400, nach dem Live-Boost)
```js
const activeDateStr = h.time[s] ? h.time[s].slice(0,10) : null;
const lb = applyLiveStationBoost(wins, gust, live, activeDay===0);
const mc = applyMeasuredStationCorrection(lb.wins, lb.gust, measured, activeDateStr);
const winsEff = mc.wins, gustEff = mc.gust;
```
`winsEff`/`gustEff` speisen **weiterhin** alle Kennzahlen (midW, midG, scores, avgW,
maxG, dayScore, session) — bereits so von v3.12.0. Rückgabe zusätzlich `measuredCorr: mc`.
Live-Boost und Measured-Korrektur schließen sich faktisch aus (ein Spot ist live
ODER measured), beide sind No-Op-sicher; die Verkettung (`lb.wins`→`mc`) ist unschädlich.

## 3. „Heute"/aktives Pill (dayScores-Loop ~index.html:1440)
`measured` ist nur für den **aktiven** Tag gefetcht. Daher im Loop:
```js
const dstr = forecast.hourly.time[start] ? forecast.hourly.time[start].slice(0,10) : null;
let slice = forecast.hourly.windspeed_10m.slice(start, start+24);
let gslice= forecast.hourly.windgusts_10m.slice(start, start+24);
if (d === 0) { const lb=applyLiveStationBoost(slice,gslice,live,true); slice=lb.wins; gslice=lb.gust; }
if (d === activeDay) { const mc=applyMeasuredStationCorrection(slice,gslice,measured,dstr); slice=mc.wins; gslice=mc.gust; }
return scoreDay(slice, win, 0);
```
(Der bestehende `d===0`-Live-Zweig bleibt; nur der measured-Zweig kommt dazu.)

## 4. UI-Indikator
Den bestehenden Live-Boost-Badge (v3.12.0) um den measured-Fall erweitern: wenn
`dayData.measuredCorr?.applied`, kleiner Hinweis
`↑ an Station {measuredCorr.station}{km>=2?` (~${km} km)`:""} angepasst`
in `C.signal`. Rein informativ. `applyConfidence` unberührt.

## 5. Versionierung
- `index.html` v3.12.0 → **v3.13.0** (4 Header-Stellen). Frontend-only.
- `VERSIONS.md`: `## v3.13.0`-Block (deutsch, Datum 2026-08-02).

## 6. TESTPLAN (Phase 5) — `wing-scoring.test.mjs` erweitern
`// <<measured-correction>>`-Block per vm laden (Sandbox: `Math`; keine kn-Helfer nötig).
1. **Kein/ungültig** (`null`, `ok:false`, kein `hourly`) → `applied:false`, Arrays identisch.
2. **Datum-Mismatch** (`measured.date!==activeDateStr`) → unverändert.
3. **Nahe Station** (`km:0` → w=0.8): Stunden mit `mw>model` steigen um `(mw-model)*0.8`;
   Stunden mit `mw<=model` **unverändert**; `null`-Messstunden unverändert. Numerisch prüfen.
4. **Ferne Station** (`km:35`): `measuredWeight(35)= 0.8*(1-35/50)=0.24`; Anhebung entsprechend schwächer.
5. **Raise-only:** überall `mw<model` → `applied:false`, unverändert (Torbole-heute-Fall).
6. **Gust** wird korrigiert; `gust=null` bricht nicht.
7. **`measuredWeight`-Ränder:** 0→0.8, 50→0, 60→0, `null`→0.8.
8. **Score-Wirkung:** Vasiliki-artig (model 12–16h niedrig, LGPZ höher, km=35) →
   `scoreDay(corr,win) >= scoreDay(roh,win)`; non-mutating (Original unverändert).
Health: `node --test wing-scoring.test.mjs feedback-wing-range.test.mjs` grün; `node -c proxy-server.js`.

## Offene Annahmen (Phase 6 bestätigen)
- **D1** `STATION_TRUST_AT_SPOT=0.8`, `STATION_MAX_KM=50`, lineares Distanzgewicht (tunbar).
- **D2** **Raise-only, keine Vorwärts-Extrapolation** — für measured korrigieren wir nur
  beobachtete Stunden. Eine Vorwärts-Nowcast-Schicht (Bias aus letzter Messung auf die
  Rest-Thermik, wie beim Live-Boost) ist bewusster **Follow-up**, nicht in diesem Schritt.
- **D3** Live-Boost (v3.12.0) bleibt für Live-only-Stationen (Talamone); measured für den Rest.
  Kein Spot hat beide → keine Doppelkorrektur.
- **D4** Chart zeigt weiter Roh-Forecast + Stations-Overlay getrennt; nur die Bewertung nutzt die Korrektur.
