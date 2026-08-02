# DESIGN — Harlem-Pace-Integration (Phase 3, Opus 5)

Verbindliche Umsetzungsvorgabe für Phase 4 (Sonnet 5). **Keine eigenständigen
Architekturentscheidungen** — bei Unklarheit Rückfrage, nicht raten.

## User-Entscheidungen (aus Phase 3-Klärung)

1. **Integrationsart: Blend** — finales Windfenster = gewichteter Mittelwert aus
   Physikmodell (`calcWindow`) und Herstellertabelle.
2. **Gewichtsskalierung: √-Skalierung** — Tabellen-Windgrenzen × `sqrt(weight/refWeight)`,
   `refWeight = 78 kg`.
3. **Marken-Matching: nur Datenstruktur** — erweiterbare `WING_BRANDS`-Struktur,
   Harlem Pace als **global aktive Default-Tabelle**, kein Per-User-Matching,
   keine DB-/Route-Änderung in diesem Schritt.

## Scope

- **Nur `index.html`** wird geändert (Scoring lebt dort inline). Kein Backend,
  keine DB, keine `.mjs`. Konsistent mit Ist-Zustand (`calcWindow` ist inline).
- `VERSIONS.md`: neuer Eintrag.
- Version-Bump `index.html`: **v3.9.0 → v3.10.0** (Minor: neues Scoring-Verhalten).

## 1. Datenstruktur (neu, in `index.html` direkt vor `scoreHour`)

```js
// ── Wing manufacturer windrange tables (extensible) ──────────────────────────
// Per Marke/Modell: Hersteller-Windrange (kn) + Wing-Masse (kg) je Größe (m²).
// Die Ranges gelten für ein Referenzgewicht; das echte Gewicht skaliert sie
// (√-Gesetz). Aktuell wird die Default-Tabelle global angewandt (noch kein
// Per-User-Marken-Matching — Datenstruktur ist dafür vorbereitet).
const WING_BRANDS = {
  "Harlem Pace": {
    refWeightKg: 78,
    sizes: {
      3: { rangeKn: [20, 32], wingKg: 1.76 },
      4: { rangeKn: [16, 28], wingKg: 2.12 },
      5: { rangeKn: [14, 26], wingKg: 2.32 },
      6: { rangeKn: [10, 22], wingKg: 2.77 },
    },
  },
};
const DEFAULT_WING_BRAND = "Harlem Pace";
const TABLE_BLEND = 0.5;   // Gewicht der Tabelle vs. Physikmodell im Blend
```

## 2. Tabellen-Fenster (neu)

```js
// Hersteller-Windfenster für eine Wing-Größe: linear zwischen den Tabellenstufen
// interpoliert und aufs Fahrergewicht reskaliert (√-Gesetz: wind ∝ √(gewicht/ref)).
// Gibt {outOfRange:true, reason} zurück, wenn die Größe außerhalb der Tabelle
// liegt — KEINE stille Extrapolation über 3–6 m² hinaus.
function wingTableWindow(weight, wingM2, brandKey = DEFAULT_WING_BRAND) {
  const brand = WING_BRANDS[brandKey];
  if (!brand) return null;
  const stops = Object.keys(brand.sizes).map(Number).sort((a,b)=>a-b);
  const lo = stops[0], hi = stops[stops.length-1];
  if (wingM2 < lo || wingM2 > hi) {
    return { outOfRange: true,
             reason: `Wing ${wingM2} m² außerhalb Herstellerangabe (${lo}–${hi} m²)` };
  }
  let a = lo, b = hi;
  for (let i = 0; i < stops.length - 1; i++) {
    if (wingM2 >= stops[i] && wingM2 <= stops[i+1]) { a = stops[i]; b = stops[i+1]; break; }
  }
  const ra = brand.sizes[a].rangeKn, rb = brand.sizes[b].rangeKn;
  const t = (a === b) ? 0 : (wingM2 - a) / (b - a);
  const minKn = ra[0] + (rb[0] - ra[0]) * t;
  const maxKn = ra[1] + (rb[1] - ra[1]) * t;
  const f = Math.sqrt(weight / brand.refWeightKg);
  const minMs = knToMs(minKn * f), maxMs = knToMs(maxKn * f);
  // Hersteller nennt nur die Außenränge; das Optimalband wird in die obere Mitte
  // gelegt (Foil-Wings tragen mittig-oben am besten). Heuristik, dokumentiert.
  return {
    minWind: Math.round(minMs * 10) / 10,
    optMin:  Math.round((minMs + 0.25 * (maxMs - minMs)) * 10) / 10,
    optMax:  Math.round((minMs + 0.75 * (maxMs - minMs)) * 10) / 10,
    maxWind: Math.round(maxMs * 10) / 10,
    outOfRange: false,
  };
}
```

## 3. Kanonisches Fenster (neu) — ersetzt `calcWindow` an allen Call-Sites

```js
// EINZIGE kanonische Scoring-Quelle: Physikmodell, geblendet mit der
// Herstellertabelle, wenn die Wing-Größe abgedeckt ist. Überall konsumiert
// (Chart, Tages-Scores, pickBestSetup).
function wingWindow(weight, wingM2, foilCm2, skill, knownPlaneMs,
                    brandKey = DEFAULT_WING_BRAND) {
  const phys = calcWindow(weight, wingM2, foilCm2, skill, knownPlaneMs);
  // Fahrer-kalibrierte Planing-Schwelle = Ground Truth → nie verwässern.
  if (knownPlaneMs && knownPlaneMs > 0) return phys;
  const tab = wingTableWindow(weight, wingM2, brandKey);
  if (!tab || tab.outOfRange) return phys;   // keine Tabellendaten → reine Physik
  const b = TABLE_BLEND, p = 1 - b;
  return {
    minWind: Math.round((p*phys.minWind + b*tab.minWind) * 10) / 10,
    optMin:  Math.round((p*phys.optMin  + b*tab.optMin ) * 10) / 10,
    optMax:  Math.round((p*phys.optMax  + b*tab.optMax ) * 10) / 10,
    maxWind: Math.round((p*phys.maxWind + b*tab.maxWind) * 10) / 10,
  };
}
```

### Call-Sites (index.html) — `calcWindow(...)` → `wingWindow(...)`, Argumente identisch
- Zeile **488** (in `pickBestSetup`): `calcWindow(weight, parseFloat(g.wing), parseFloat(g.foil), skill, plane)` → `wingWindow(...)`
- Zeile **1257**: `calcWindow(rider.weight, rider.wingSize, rider.foilFront, rider.skill, effPlaneMs)` → `wingWindow(...)`
- Zeile **1280**: dito → `wingWindow(...)`

`calcWindow` bleibt unverändert bestehen (internes Physik-Helferlein). `scoreHour`,
`scoreDay`, `bestSession` bleiben **unverändert** — sie konsumieren nur das Fenster.

## 4. Randverhalten (Phase 3.2) — kein Silent-Fail

- **Wing < 3 oder > 6 m²:** `wingTableWindow` liefert `{outOfRange:true, reason}`;
  `wingWindow` fällt auf reine Physik zurück. Der `reason`-String ist für eine
  spätere UI-Kennzeichnung vorhanden (in diesem Schritt nicht zwingend angezeigt).
- **Wind unter/über der Gesamtrange (≈10 kn / 32 kn):** wird von `scoreHour`
  bereits graduell behandelt (unter `minWind`: `(w/minWind)*45`; über `maxWind`:
  fallend bis 0). Kein stiller 0-Score, keine Ausnahme. Keine Änderung nötig.
- **Kalibrierte Planing-Schwelle gesetzt:** `wingWindow` gibt exakt das bisherige
  Physikfenster zurück (identisches Verhalten wie vor der Änderung).

## 5. SSOT & Versionierung

- `wingWindow` wird die einzige Fenster-Quelle; keine Parallel-Logik in der UI.
- **Sentinel-Kommentare** um den Scoring-Block für Testbarkeit (siehe TESTPLAN):
  direkt **vor** `function calcWindow` die Zeile `// <<wing-scoring>>` und direkt
  **nach** `function wingWindow(){...}`-Ende die Zeile `// <</wing-scoring>>`.
  Der Block enthält damit: `calcWindow`, `WING_BRANDS`, `DEFAULT_WING_BRAND`,
  `TABLE_BLEND`, `wingTableWindow`, `wingWindow`, `scoreHour`, `scoreDay`,
  `bestSession`, `pickBestSetup`.
- Versions-Header `index.html` v3.9.0 → **v3.10.0** an **4 Stellen**:
  Zeile 3 (`<!-- v3.9.0 -->`), 39 (`// WindFoil Weather Intelligence v3.9.0`),
  1500 (Footer `· v3.9.0`), 2151 (`WindFoil Weather Intelligence v3.9.0`).
- `VERSIONS.md`: neuen `## v3.10.0`-Block oben einfügen.

## Offene Annahmen (Phase 6 vom User bestätigen lassen)

- **A1 — Blend-Gewicht `TABLE_BLEND = 0.5`:** 50/50 als Default gesetzt; tunbar.
- **A2 — Optimalband 25 %/75 %:** Hersteller nennt nur Außenränder; das
  Optimalband ist heuristisch ins obere Mittelfeld gelegt.
- **A3 — Referenzgewicht 78 kg:** Harlem nennt kein offizielles Referenzgewicht;
  78 kg als branchenüblicher Mittelwert angenommen.
- **A4 — Foil-Einfluss:** Da die Tabelle foil-agnostisch ist, wird der Einfluss
  des Foils aufs finale Fenster im geblendeten Pfad um `TABLE_BLEND` (50 %)
  gedämpft. Das Foil-**Scoring selbst** (`calcWindow`-Foil-Term) bleibt unberührt;
  bei kalibrierter Schwelle oder Wing außerhalb 3–6 m² ist der Foil-Einfluss
  unverändert. → Grenzfall des Non-Goals "keine Änderung am Foil-Scoring";
  bewusst so, weil Blend gewählt wurde. User bestätigen.

## TESTPLAN (Phase 5) — Opus definiert, Sonnet implementiert

**Datei:** `wing-scoring.test.mjs` (Repo-Root, Node `node:test`).
**Ansatz:** Produktionscode real testen, ohne Duplikat: index.html lesen, den
Block zwischen `// <<wing-scoring>>` und `// <</wing-scoring>>` per `node:vm`
in einem Sandbox-Context ausführen (Sandbox stellt `knToMs = kn=>kn/1.94384`,
`msToKn = ms=>ms*1.94384` bereit). Dann `wingWindow`, `wingTableWindow`,
`calcWindow`, `scoreHour` aus dem Context ziehen und asserten.

Pflicht-Fälle:

1. **Gewicht niedrig/mittel/hoch × alle vier Stufen (3/4/5/6 m²)** bei je einer
   Windzahl innerhalb der jeweiligen Stufe. Asserts:
   - `wingTableWindow(78, size).minWind/maxWind` ≈ `knToMs(rangeKn)` (±0.05 m/s).
   - Schwerer Fahrer (95 kg) → `minWind`/`maxWind` **höher** als bei 78 kg;
     leichter (60 kg) → **niedriger** (Monotonie der √-Skalierung).
   - `sqrt(95/78)`-Faktor exakt auf min/max nachrechnen (Grenze 3 m²:
     20 kn × √(95/78) ≈ 22.06 kn → prüfen ±0.1 kn nach Rückrechnung `msToKn`).
2. **Interpolation Zwischengröße:** `wingTableWindow(78, 4.5)` min/max = exakt
   Mittel aus 4er- und 5er-Stufe (min: (16+14)/2=15 kn; max: (28+26)/2=27 kn).
3. **Stufengrenzen-Wind (26 kn, 28 kn):** `scoreHour` auf `wingWindow(78,5,...)`
   und `wingWindow(78,4,...)` — monoton fallend jenseits `optMax`, kein Sprung/NaN.
4. **Außerhalb Gesamtrange:** Wind 5 kn (<10) und 40 kn (>32) → `scoreHour`
   liefert kleinen, aber definierten Score ≥0, **kein** NaN/Exception.
5. **Wing außerhalb 3–6 m²:** `wingTableWindow(78, 2)` und `(78, 7)` →
   `outOfRange:true` mit `reason`. `wingWindow(78, 2, …)` === `calcWindow(78, 2, …)`
   (Blend-Bypass, deep-equal).
6. **Regression Foil/Kalibrierung:**
   - `wingWindow(80, 5, foil, skill, planeMs=6.0)` deep-equal `calcWindow(...)`
     (kalibrierte Schwelle → Bypass, Foil-Scoring unberührt).
   - Variation von `foilCm2` verändert `calcWindow`-Ergebnis wie bisher.
7. **E2E-Sweep Navarino/Gialova:** Demo-Windserie (m/s) über 24 h für Gialova
   durch `wingWindow(80,5,1800,"intermediate",null)` → `scoreDay`/`bestSession`;
   mehrere Szenarien (schwach ~8 kn, ideal ~18 kn, stark ~30 kn) → Score-Plausi:
   schwach < ideal, stark < ideal, ideal nahe 100. (Analog bisherige Feature-Tests.)

**Health-Check:** `node wing-scoring.test.mjs` grün; danach `node -c proxy-server.js`
(Syntax) — kein Deploy.
