# DESIGN — Foil aus Bewertung & Equipment entfernen (Phase 3, Opus 5)

Verbindliche Umsetzungsvorgabe. Umsetzung: Sonnet 5. **Keine eigenständigen
Architekturentscheidungen** — bei echter Unklarheit STOPP + melden.

## Entscheidung (User bestätigt)
- Bewertung hängt künftig nur an **Wing-Größe + Fahrergewicht + Skill**. **Foil raus.**
- **Skill bleibt** drin (Fahrer-Attribut, kein Equipment).
- Foils komplett aus dem Equipment (Gear-Liste + „Add-Gear"-UI + Rider-Foil-Feld).

## 1. Scoring — `index.html`, im `// <<wing-scoring>>`-Block
### calcWindow: Foil-Parameter raus, Referenz-Foil-Beitrag als Konstante
Der alte Term `foilF = 1800/foilCm2; ... + foilF*0.8` wird durch die **Referenz-
Foil-Konstante** ersetzt (foilF bei 1800 cm² = 1.0 → Beitrag 0.8). Damit bleibt das
Fenster identisch zu einem 1800-cm²-Foil, ist aber foil-unabhängig.
```js
const REF_FOIL_TERM = 0.8;   // = altes foilF*0.8 bei Referenz-Foil 1800 cm²
function calcWindow(weight, wingM2, skill, knownPlaneMs) {   // foilCm2 ENTFERNT
  const sMin = {beginner:1.50,intermediate:1.25,advanced:1.00,pro:0.85}[skill]??1.15;
  const sOpt = {beginner:1.60,intermediate:2.00,advanced:2.60,pro:3.20}[skill]??2.00;
  const sMax = {beginner:2.00,intermediate:2.60,advanced:3.50,pro:4.50}[skill]??2.60;
  let minW;
  if (knownPlaneMs && knownPlaneMs > 0) {
    minW = knownPlaneMs;
  } else {
    const load = weight / wingM2;
    minW = Math.max(2.5, (3.5 + load*0.15 + REF_FOIL_TERM) * sMin * 0.85);
  }
  return { minWind:Math.round(minW*10)/10, optMin:Math.round(minW*1.2*10)/10,
           optMax:Math.round(minW*sOpt*10)/10, maxWind:Math.round(minW*sMax*10)/10 };
}
```
### wingWindow: Foil-Parameter raus
```js
function wingWindow(weight, wingM2, skill, knownPlaneMs,
                    brandKey = DEFAULT_WING_BRAND, spotWingRange = null) {
  const phys = calcWindow(weight, wingM2, skill, knownPlaneMs);   // kein foil mehr
  ... (Rest unverändert: Bypass, tab, base=blendWindows(phys,tab,TABLE_BLEND),
       Feedback-Layer)
}
```
### pickBestSetup: kein g.foil mehr
```js
function pickBestSetup(gearList, weight, skill, windMs, wingRanges=null) {
  ...
  for (const g of gearList) {
    const plane = g.planeKn ? (parseFloat(g.planeKn)/1.94384) : null;
    const swr = wingRanges ? wingRanges[String(parseFloat(g.wing))] : null;
    const win = wingWindow(weight, parseFloat(g.wing), skill, plane, DEFAULT_WING_BRAND, swr); // foil raus
    ...
  }
}
```

## 2. Call-Sites (index.html) — `rider.foilFront` streichen
- ~1500 / ~1523 (Fallback): `wingWindow(rider.weight, rider.wingSize, rider.skill, effPlaneMs, DEFAULT_WING_BRAND, spotWingMap?.[String(rider.wingSize)])`.

## 3. Datenmodell (Frontend-State/Defaults)
- `rider`-Default (Zeile ~1119/1120): `foilFront` **entfernen** → `{weight:80, wingSize:5.0, skill:"intermediate", planeKn:""}`. Stale `foilFront` in bereits gespeicherten Blobs ist harmlos (wird nicht mehr gelesen), aber der Default trägt es nicht mehr.
- `newGear`-Default (~1125): `foil` entfernen → `{name:"", wing:"5.0", planeKn:""}`.
- Gear-Objekte: `foil`-Feld entfällt (`[{id,name,wing,planeKn}]`).

## 4. UI-Entfernungen (index.html)
- **Rider-Profil-Feld „Foil Front (cm²)"** (~1807 im Feld-Array): Zeile entfernen.
- **Add-Gear „Foil (cm²)"**-Input (~1875/1876): Label + `<input>` entfernen.
- Add-Gear-Validierung (~1886): `if(!newGear.wing||!newGear.foil)` → `if(!newGear.wing)`.
- Add-Gear-Reset (~1890): `foil:"1800"` aus dem Reset-Objekt entfernen.
- Gear-Listen-Anzeige (~1856): `· {g.foil}cm²` entfernen → nur `{g.wing}m²{planeKn?...}`.
- Empfehlungs-Text (~1573): `· Foil ${pickedGear.foil} cm²` entfernen.
- Summary-Text (~1580): `· Foil ${foilFront} cm²` entfernen; Destructuring (~1569) `foilFront` streichen.
- Setup-Summary (~1974/1975): Foil-Teile entfernen (`(${...wing}m²·${...foil}cm²)` → `(${...wing}m²)`; `· ${rider.foilFront}cm²` weg).
- **Behalten:** die Labels „Foil-Score" / „Foil-Fenster" (~1963/2006/2044/2058) — das ist der Produktname der Bewertung (Foilen), **keine** Foil-Größe. Nicht anfassen.

## 5. Versionierung
- `index.html` v3.13.0 → **v3.14.0** (4 Header-Stellen). Frontend-only.
- `VERSIONS.md`: `## v3.14.0`-Block (deutsch, Datum 2026-08-03).

## 6. TESTPLAN (Phase 5) — `wing-scoring.test.mjs`
**Achtung Arität:** ALLE bestehenden `calcWindow(...)`- und `wingWindow(...)`-Aufrufe
in den Tests haben aktuell ein `foil`-Argument → müssen auf die neue Signatur
umgestellt werden (foil-Argument entfernen). Das betrifft viele Fälle — sorgfältig
alle anpassen, bis grün. Zusätzlich:
1. **Foil-Unabhängigkeit:** (implizit durch Signatur) — `calcWindow(80,5,"intermediate",null)`
   liefert exakt das alte Ergebnis von `calcWindow(80,5,1800,"intermediate",null)` (Referenz-Foil).
   Numerisch gegen den bekannten v3.13.0-Wert für foil=1800 prüfen.
2. **Skill wirkt weiter:** `calcWindow(80,5,"beginner",null).maxWind` < `...("pro",null).maxWind`.
3. Regression: `wingWindow`-Blend/Feedback-Layer unverändert (nur ein Argument weniger).
Die Blöcke `live-boost`/`measured-correction` sind **nicht** betroffen (kein foil).
Ausführen: `node --test wing-scoring.test.mjs feedback-wing-range.test.mjs` → grün.
`node -c proxy-server.js` ok.

## Nicht-Ziele / Hinweise
- `src/equipment.routes.mjs` (Tabelle `equipment`, kind wing/foil) NICHT anfassen —
  separates, vom Nutzer ungenutztes System; out of scope.
- Migration/DB: keine.
- Die Bereinigung von Maiks gespeichertem `wf_gear` (Dedup auf Wing-Größen, foil-frei)
  macht **Opus** separat als Daten-Write nach dem Code-Merge — NICHT Teil deiner Aufgabe.

## Offene Annahme (Phase 6)
- **E1** Referenz-Foil-Konstante = 0.8 (entspricht 1800 cm²). Damit bleibt das Fenster
  neutral auf dem bisherigen Referenzwert; foil-freie Bewertung ohne Sprung.
