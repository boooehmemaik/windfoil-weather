# DESIGN — Live-Nowcast-Anker + Böen-Fahrbarkeit (Phase 3, Opus)

Verbindliche Umsetzungsvorgabe. Umsetzung: Sonnet. **Keine eigenständigen
Architekturentscheidungen** — bei echter Unklarheit STOPP + melden.

## Problem (real gemessen, 2026-08-06 13:38 Talamone)
Live-Station: **10,4 kn Grundwind, Böen 17,4 kn**. Modell (Stunde 13): **8,0 kn**,
Peak erst 17 h. Das Modell ist im **Timing/Ramp zu langsam**; der bestehende
`applyLiveStationBoost` (v3.12.0) skaliert nur die langsame Modell-Form hoch und
nutzt **nur Grundwind** → die aktuelle Stunde bleibt unter der Abhebe-Grenze,
obwohl es in den Böen längst fahrbar ist.

## User-Entscheidung
**„Live NOW direkt ankern + Böen":** aktuelle + nächste Stunde direkt an der
Live-Station verankern (statt skaliertem Modell) UND Böen in die Fahrbarkeit
einbeziehen. Reagiert sofort auf „es bläst jetzt".

## Änderung: `applyLiveStationBoost` erweitern (nur Live-Stationen, `// <<live-boost>>`)
Frontend-only. `msToKn`/`knToMs` sind global vorhanden. Non-mutating (`.slice()`).

Neue Konstanten (neben den bestehenden `LIVE_BOOST_*`):
```js
const LIVE_GUST_BLEND   = 0.5;  // Anteil der Böe im "Jetzt"-Anker (0=nur Grundwind, 1=nur Böe)
const LIVE_ANCHOR_HOURS = 2;    // aktuelle + (N-1) Folgestunden direkt an Live verankern
```

Neue Funktionslogik (ersetzt den Rumpf von `applyLiveStationBoost`, Signatur bleibt
`(wins, gust, live, isToday)`):
```js
function applyLiveStationBoost(wins, gust, live, isToday) {
  const none = { wins, gust, k: 1, applied: false, station: null, nowKn: null };
  if (!isToday || !live || !live.ok || live.sensorOk === false || live.wind == null) return none;
  const nowH = live.time ? parseInt(live.time.slice(0,2),10) : new Date().getHours();
  if (!(nowH >= LIVE_BOOST_ACTIVE_MIN && nowH <= LIVE_BOOST_ACTIVE_MAX)) return none;
  const modelNow = wins[nowH];
  if (modelNow == null || modelNow < LIVE_BOOST_MIN_MODEL) return none;

  // Böen-bewusster "Jetzt"-Wind: Grundwind + Anteil Richtung jüngster Spitzenböe.
  const gustMs  = (live.gustMax != null ? live.gustMax
                 : live.gust != null ? live.gust : live.wind);
  const effLive = live.wind + LIVE_GUST_BLEND * Math.max(0, gustMs - live.wind);

  const bw = wins.slice(), bg = gust ? gust.slice() : gust;
  let applied = false;

  // (1) Direkter Nowcast-Anker für aktuelle + nächste Stunde(n) — Realität gewinnt
  //     jetzt, RAISE-ONLY (nie einen guten Forecast kappen), böen-bewusst.
  for (let h = nowH; h < nowH + LIVE_ANCHOR_HOURS && h <= 23; h++) {
    if (bw[h] != null && effLive > bw[h]) { bw[h] = Math.round(effLive * 100) / 100; applied = true; }
    if (bg && gustMs != null && (bg[h] == null || gustMs > bg[h])) bg[h] = Math.round(gustMs * 100) / 100;
  }

  // (2) Fenster-weiter multiplikativer Lift für den Rest des Thermikfensters,
  //     verankert am GRUNDWIND-Verhältnis (konservativ, keine Böen-Extrapolation).
  let k = live.wind / modelNow;
  if (k >= LIVE_BOOST_MIN_RATIO) {
    k = Math.min(k, LIVE_BOOST_KMAX);
    for (let h = LIVE_BOOST_WIN_START; h <= LIVE_BOOST_WIN_END; h++) {
      if (h >= nowH && h < nowH + LIVE_ANCHOR_HOURS) continue; // schon verankert
      if (bw[h] != null) { const v = Math.round(bw[h] * k * 100) / 100; if (v > bw[h]) { bw[h] = v; applied = true; } }
      if (bg && bg[h] != null) { const v = Math.round(bg[h] * k * 100) / 100; if (v > bg[h]) bg[h] = v; }
    }
  } else { k = 1; }

  return applied
    ? { wins: bw, gust: bg, k: Math.round(k * 100) / 100, applied: true,
        station: live.label || live.key || "Live-Station",
        nowKn: Math.round(msToKn(effLive) * 10) / 10 }
    : none;
}
```

### Verhaltensgarantien
- **Raise-only:** verankert/boostet nur nach oben; ein bereits höherer Forecast bleibt.
- **Anker vor Boost:** die verankerten Stunden werden im Boost-Loop übersprungen (kein Doppel).
- **Böen nur „jetzt":** der Anker ist böen-bewusst; der Fenster-Boost bleibt grundwind-basiert
  (Böen nicht in die Zukunft extrapolieren).
- Rückwärtskompatibel: kein Live / `applied:false` → Arrays unverändert.

## UI — Badge aussagekräftiger (bestehender Live-Boost-Badge, ~index.html:1976)
Statt „× k" den Jetzt-Wert zeigen, wenn vorhanden:
```
↑ Live-Station {liveBoost.station}: jetzt ~{liveBoost.nowKn} kn
```
Fallback auf „(×{k})", wenn `nowKn` null. Rein informativ.

## Versionierung
- `index.html` v3.14.4 → **v3.15.0** (neues Scoring-Verhalten, 4 Header-Stellen). Frontend-only.
- `VERSIONS.md`: `## v3.15.0`-Block (deutsch, Datum 2026-08-06).

## TESTPLAN (Phase 5) — `wing-scoring.test.mjs` (live-boost-Fälle anpassen/ergänzen)
Sandbox stellt `knToMs`/`msToKn`/`Math`/`Date`. Bestehende live-boost-Tests auf neue
Erwartung anpassen; neue Fälle:
1. **Nowcast-Anker:** live={wind:knToMs(10.4),gustMax:knToMs(17.4),time:"13:38",sensorOk:true,ok:true},
   Modell[13]=knToMs(8). Erwartung: `wins[13]` und `wins[14]` = `effLive` =
   `knToMs(10.4)+0.5*(knToMs(17.4)-knToMs(10.4))` (≈ knToMs(13.9)); `nowKn≈13.9`; `applied:true`.
2. **Raise-only Anker:** wenn Modell an now-Stunde bereits > effLive → unverändert.
3. **Fenster-Boost getrennt:** eine Stunde außerhalb now/next (z. B. 17h) wird mit
   k=live.wind/modelNow (Grundwind, geclamped) geliftet, NICHT mit effLive.
4. **Böen-Array:** `gust[now]` = gustMs (17.4 kn); `gust=null` bricht nicht.
5. **k<Schwelle:** wenn Grundwind-Ratio <1.2 → Fenster-Boost aus, aber Anker greift trotzdem
   (now/next verankert), `k===1` im Return.
6. **Gate/Bypass:** nicht heute / kein Live / sensorOk:false / nowH außerhalb 11–20 → unverändert.
7. **Score-Wirkung:** `scoreDay`/`scoreHour` mit dem Talamone-Fall (93 kg, 6.0) höher als roh;
   `scoreHour(effLive, wingWindow(93,6,"intermediate",null))` > `scoreHour(modelNow, …)`.
8. **Regression measured-correction & wing-scoring:** unberührt (kein foil/gust-Eingriff dort).
Ausführen: `node --test wing-scoring.test.mjs feedback-wing-range.test.mjs system-test-foil-removal.mjs` grün; `node -c proxy-server.js`; inline-JSX per esbuild syntax-validieren.

## Offene Annahmen (Phase 6)
- **F1** `LIVE_GUST_BLEND=0.5` (Böe zu 50 % im Jetzt-Anker; 10,4/17,4 → ~13,9 kn). Tunbar.
- **F2** `LIVE_ANCHOR_HOURS=2` (aktuelle + nächste Stunde). Tunbar.
- **F3** Böen nur im „Jetzt"-Anker, nicht im Fenster-Boost (keine Zukunfts-Böen-Extrapolation).
- **F4** Nur Live-Stationen (Talamone). Measured-Stationen (Torbole/LGPZ) analog wäre Follow-up.
