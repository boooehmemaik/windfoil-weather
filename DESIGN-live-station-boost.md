# DESIGN — Live-Station-Nowcast-Boost (Phase 3, Opus 5)

Verbindliche Umsetzungsvorgabe. Umsetzung: Sonnet 5 (Phase 4/5). **Keine
eigenständigen Architekturentscheidungen** — bei echter Unklarheit STOPP + melden.

## Problem & Ziel
Der Tages-Score rechnet auf dem Open-Meteo-Forecast. An Spots mit **echter
Live-Station** (z. B. Talamone-Davis) unterschätzt das Modell die Nachmittags-
Thermik teils um ~2× → App zeigt „zu wenig", obwohl die Station längst 15 kn
misst. **Ziel:** die reale Live-Messung von **heute** in den Score einrechnen,
statt sie nur als „Jetzt"-Marker zu zeigen.

## Kernentscheidung: frontend-only, datengetriebener Boost
Die `live`-Stationsdaten werden bereits gefetcht (`index.html`, `setLive`,
`/api/station/live`, 60-s-Refresh, `live = {ok,wind(m/s),gust,dir,time"HH:MM",sensorOk,...}`).
Kein Backend-/DB-/Proxy-Change. Vorbild: `applyPelerBoost` (index.html:321), aber:
- **datengetrieben** (Faktor aus Live/Modell-Verhältnis, nicht empirisch fest),
- **nur heute** (eine „Jetzt"-Messung kann keine Zukunftstage korrigieren),
- **non-mutating** (arbeitet auf einer Kopie der Tages-Slice, nicht auf `fc`).

## 1. Neue reine Funktion (in eigenem Sentinel-Block, direkt nach `applyPelerBoost`)
```js
// <<live-boost>>
// Live-Station-Nowcast-Boost: hebt HEUTE den vom Modell unterschätzten Wind an
// echten Live-Stationen (z. B. Talamone) an. Faktor = Live/Modell zur Messstunde,
// geclamped; angewandt auf das Nachmittags-Thermikfenster. Non-mutating: liefert
// eine neue Wind-Kopie. Nur heute, nur wenn die Station real höher misst.
const LIVE_BOOST_MIN_RATIO   = 1.2;          // Station muss >=20% über Modell liegen
const LIVE_BOOST_KMAX        = 2.0;          // Clamp des Boost-Faktors
const LIVE_BOOST_MIN_MODEL   = 3 / 1.94384;  // Modell-Mindestwind (m/s) für stabiles Verhältnis
const LIVE_BOOST_WIN_START   = 11;           // Thermik-Fenster (lokale Stunde)
const LIVE_BOOST_WIN_END     = 19;
const LIVE_BOOST_ACTIVE_MIN  = 11;           // nur wenn "jetzt" innerhalb der Thermik-Aktivzeit
const LIVE_BOOST_ACTIVE_MAX  = 20;

// wins/gusts: 24h-Slices (m/s) des Tages. Gibt { wins, gust, k, applied, station } zurück.
function applyLiveStationBoost(wins, gust, live, isToday) {
  const none = { wins, gust, k: 1, applied: false, station: null };
  if (!isToday || !live || !live.ok || live.sensorOk === false || live.wind == null) return none;
  const nowH = live.time ? parseInt(live.time.slice(0,2),10) : new Date().getHours();
  if (!(nowH >= LIVE_BOOST_ACTIVE_MIN && nowH <= LIVE_BOOST_ACTIVE_MAX)) return none;
  const modelNow = wins[nowH];
  if (modelNow == null || modelNow < LIVE_BOOST_MIN_MODEL) return none;
  let k = live.wind / modelNow;
  if (k < LIVE_BOOST_MIN_RATIO) return none;          // Station nicht nennenswert höher
  k = Math.min(k, LIVE_BOOST_KMAX);
  const bw = wins.slice(), bg = gust ? gust.slice() : gust;
  for (let h = LIVE_BOOST_WIN_START; h <= LIVE_BOOST_WIN_END; h++) {
    if (bw[h] != null) bw[h] = Math.round(bw[h] * k * 100) / 100;
    if (bg && bg[h] != null) bg[h] = Math.round(bg[h] * k * 100) / 100;
  }
  return { wins: bw, gust: bg, k: Math.round(k*100)/100, applied: true,
           station: live.label || live.key || "Live-Station" };
}
// <</live-boost>>
```
Platzierung: unmittelbar nach `applyPelerBoost` (~index.html:334), **außerhalb**
des `// <<wing-scoring>>`-Blocks, in eigenen `// <<live-boost>>`-Sentinels (für den Test).

## 2. Verdrahtung im `dayData`-Memo (~index.html:1400)
Nach den Slices `wins`/`gust`:
```js
const lb = applyLiveStationBoost(wins, gust, live, activeDay===0);
const winsEff = lb.wins, gustEff = lb.gust;
```
Danach **alle** Score-/Kennzahl-Berechnungen auf `winsEff`/`gustEff` umstellen:
`midW` (12–16 aus winsEff), `midG` (aus gustEff), `scores=winsEff.map(...)`,
`avgW` (winsEff), `maxG` (gustEff), `dayScore=scoreDay(winsEff,win)`,
`session=bestSession(winsEff,win)`. Die **rohen** `wins`/`gust` bleiben fürs
Chart erhalten (Rohverlauf), nur die Bewertung nutzt `winsEff`. `midDir`/`dirs`/
`temp`/`pres`/`thermik` unverändert. Rückgabeobjekt um `liveBoost: lb` erweitern.

## 3. „Heute"-Pill konsistent (dayScores-Loop ~index.html:1440)
Für `d===0` denselben Boost anwenden, sonst zeigt das Pill 23 und das Detail 85:
```js
if (d === 0) {
  const slice = forecast.hourly.windspeed_10m.slice(start, start+24);
  const gslice= forecast.hourly.windgusts_10m.slice(start, start+24);
  const lb = applyLiveStationBoost(slice, gslice, live, true);
  return scoreDay(lb.wins, win, 0);
}
return scoreDay(forecast.hourly.windspeed_10m, win, start);
```

## 4. UI-Indikator
Wo der Tages-Score/„Heute" gezeigt wird (nahe `applyConfidence`-Ausgabe ~1878/1886):
wenn `dayData.liveBoost?.applied`, kleiner Hinweis, z. B.
`↑ an Live-Station {dayData.liveBoost.station} angepasst (×{dayData.liveBoost.k})`
in `C.signal`/klein. Kein Blocker, rein informativ. `applyConfidence` bleibt wie
gehabt (Dämpfer) — kein Konflikt (korrigiert Wind vs. dämpft Score).

## 5. Versionierung
- `index.html` v3.11.0 → **v3.12.0** (4 Header-Stellen).
- `VERSIONS.md`: `## v3.12.0`-Block (deutsch, Datum 2026-08-02). Frontend-only.

## 6. TESTPLAN (Phase 5) — in `wing-scoring.test.mjs` ergänzen
Den `// <<live-boost>>`-Block zusätzlich per vm laden (Sandbox: `knToMs`/`msToKn`,
`Math`, `Date`). Fälle:
1. **Kein/ungültiger Live** (`null`, `ok:false`, `sensorOk:false`, `wind:null`) → `applied:false`, `wins`/`gust` **identisch** (Referenzgleichheit ok).
2. **Nicht heute** (`isToday=false`) → unverändert.
3. **Station ≤ Ratio-Schwelle** (Live/Modell < 1.2) → unverändert.
4. **Talamone-Fall:** wins[15]=knToMs(7.6), live={ok,sensorOk:true,wind:knToMs(15),time:"15:56"} →
   `k≈1.97` (≤2.0), `wins[15]≈knToMs(15)`, Stunden 11–19 skaliert, **wins[9]/wins[20] unverändert**, `applied:true`.
5. **Clamp:** Live/Modell=3.0 → `k===2.0`.
6. **Div-Guard:** `modelNow < 3 kn` → unverändert (kein Infinity/NaN).
7. **Aktivzeit-Gate:** `time:"22:30"` (nowH>20) → unverändert.
8. **Gust** wird mit demselben `k` skaliert; `gust=null` bricht nicht.
9. **Score-Wirkung:** `scoreDay(boosted, win)` > `scoreDay(roh, win)` für den Talamone-Fall
   (win = `wingWindow(93,5,1500,"intermediate",null)`), Plausi: Rohscore niedrig, Boost-Score deutlich höher.
Health: `node --test wing-scoring.test.mjs feedback-wing-range.test.mjs` grün; `node -c proxy-server.js`.

## Offene Annahmen (Phase 6 bestätigen)
- **C1** `LIVE_BOOST_KMAX=2.0`, `LIVE_BOOST_MIN_RATIO=1.2` (tunbar). 2.0 deckt den beobachteten
  Talamone-Miss (~1.97×) knapp ab; aus **einer** Jetzt-Messung extrapoliert → bewusst geclamped.
- **C2** Boost aufs feste Nachmittagsfenster **11–19 h** (Thermik-Muster), nicht nur ab „jetzt".
  Passt zu Thermik-Spots; bei etwaigen künftigen Nicht-Thermik-Live-Stationen neu bewerten.
- **C3** Gilt nur **heute** und nur wo eine Live-Station existiert (self-gating; die meisten
  Spots liefern `ok:false` → No-Op). Zukunftstage & `applyConfidence` unberührt.
- **C4** Chart zeigt weiter den **Rohverlauf**; nur die Bewertung nutzt den Boost (Transparenz via UI-Badge).
