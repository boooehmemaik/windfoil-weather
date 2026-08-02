# ANALYSE — Wing-Scoring Ist-Zustand (Phase 1, Opus 5)

> Stand: Repo `main` @ `36ce81a`, Arbeitsverzeichnis sauber.
> Produktions-Frontend: `index.html` (Header-Version **v3.9.0**).
> Hinweis: `VERSIONS.md` steht noch auf **v3.8.15** — der v3.9.0-Stand ist dort
> nicht dokumentiert (bestehende Abweichung, nicht Teil dieses Auftrags).

## 0. Wichtigste Abweichung von den Auftrags-Annahmen

Der Auftrag spricht durchgehend von **`scoreSetup()`**, einer Wing-Größen-
**Windrange-Tabelle** und einer möglichen **Markentrennung**. Keines davon
existiert im Repo. Die tatsächliche Architektur ist eine **physikalisch
abgeleitete** Fensterberechnung ohne Tabellen und ohne Marken.

| Auftrags-Annahme | Realität im Repo |
|---|---|
| `scoreSetup()` als kanonische Quelle | `calcWindow()` + `scoreHour()` in `index.html` |
| Windrange pro Wing-Größe hinterlegt | Range wird aus `load = weight/wingM2` **berechnet** |
| ggf. Markentrennung | keine — Wing ist nur eine Zahl (m²) |
| Backend-Scoring-Modul (`.mjs`) | keins — Scoring lebt komplett im Frontend |

## 1. Wie fließt die Wing-Größe in die Bewertung ein?

Kanonische Funktion (`index.html:438`):

```js
function calcWindow(weight, wingM2, foilCm2, skill, knownPlaneMs) {
  const sMin = {beginner:1.50,intermediate:1.25,advanced:1.00,pro:0.85}[skill]??1.15;
  const sOpt = {beginner:1.60,intermediate:2.00,advanced:2.60,pro:3.20}[skill]??2.00;
  const sMax = {beginner:2.00,intermediate:2.60,advanced:3.50,pro:4.50}[skill]??2.60;
  let minW;
  if (knownPlaneMs && knownPlaneMs > 0) {
    minW = knownPlaneMs;                       // vom Fahrer kalibrierte Planing-Schwelle
  } else {
    const load = weight / wingM2, foilF = 1800 / foilCm2;
    minW = Math.max(2.5, (3.5 + load*0.15 + foilF*0.8) * sMin * 0.85);
  }
  return { minWind, optMin: minW*1.2, optMax: minW*sOpt, maxWind: minW*sMax };
}
```

Übergebene Parameter: **Gewicht, Wing-Größe (m²), Foil-Front (cm²), Skill,
optional kalibrierte Planing-Schwelle**. Windgeschwindigkeit geht **nicht** in
`calcWindow` ein — das Fenster ist windunabhängig; die konkrete Stunden-Windzahl
wird erst in `scoreHour(w, win)` (`index.html:454`) gegen das Fenster bewertet.

Wirkung der Wing-Größe: nur über den Term `load = weight/wingM2`. Größerer Wing
→ kleineres `load` → niedrigeres `minWind` (planing früher). Der Einfluss ist
**relativ schwach** (Faktor `0.15`) und wird vom Foil-Term (`0.8`) dominiert.

## 2. Bezug Fahrergewicht ↔ Wing-Größe

**Ja, bereits gekoppelt** — über `load = weight/wingM2`. Schwerer bei gleichem
Wing → höheres `minWind`; größerer Wing bei gleichem Gewicht → niedrigeres
`minWind`. Es ist ein **kontinuierliches physikalisches Modell**, keine
diskrete "empfohlene Größe pro Gewicht"-Tabelle. Wird eine kalibrierte
Planing-Schwelle gesetzt, überschreibt sie Gewicht **und** Wing komplett.

## 3. Windrange pro Wing-Größe hinterlegt?

**Nein.** Es gibt keine Konstante, Config oder DB-Tabelle mit Windranges pro
Größe. Alles wird zur Laufzeit aus der Physik-Heuristik abgeleitet.
Herstellerangaben (wie die Harlem-Pace-Tabelle) sind aktuell nicht abbildbar.

## 4. Markentrennung?

**Keine.** `src/equipment.routes.mjs` speichert `kind` (`wing`/`foil`), `name`
(Freitext) und `size`. Das `name`-Feld wird vom Scoring **nicht** gelesen —
`pickBestSetup()` (`index.html:483`) nutzt nur `g.wing`, `g.foil`, `g.planeKn`.
Eine Marke/Modell könnte man heute nur als Freitext in `name` ablegen; es hat
keinerlei Wirkung.

## 5. Single-Source-of-Truth-Prüfung

- **Backend:** kein Scoring, kein abweichender Schwellenwert. ✅
- **Frontend-Duplikate:** Die identische `calcWindow`/`scoreHour`-Logik existiert
  in **vier** Dateien: `index.html` (Produktion), `WindFoilApp.jsx`,
  `app-react.html`, `app-react-local.html`. Nur `index.html` ist laut Deploy
  produktiv (statisch aus dem Web-Root). Die drei anderen sind Build-Quellen/
  Altstände. **Das ist ein latenter SSOT-Verstoß** (Logik viermal kopiert), aber
  kein aktiver Parallelpfad zur Laufzeit. Für diesen Auftrag: **nur `index.html`
  anfassen**; die Divergenz der Kopien getrennt notieren.
- Die UI-Anzeige (`scoreHour`-Ergebnis, `bestSession`) zieht durchgängig aus
  `calcWindow`/`scoreHour` — es gibt keine zweite Scoring-Formel in der UI. ✅

## Konsequenz für die Harlem-Pace-Integration (offene Designfragen)

Die Herstellertabelle ist **gewichtsunabhängig** (3 m² → 20–32 kn, unabhängig
vom Fahrer). Das aktuelle Modell ist **gewichtsabhängig**. Beide Philosophien
kollidieren; vor Phase 3/4 muss der User entscheiden:

1. **Integrationsart:** Ersetzt die Herstellerrange das berechnete Fenster
   (wenn der Wing als Harlem Pace erkannt wird), oder wird sie mit dem
   Physikmodell **gemischt/als Referenz** angezeigt?
2. **Gewichtsskalierung (Phase 3.2):** Herstellerranges gelten typ. für ~75–80 kg.
   Wie soll das Gewicht die Tabellenrange verschieben? (Nicht eindeutig aus dem
   Ist-Zustand ableitbar → Klärung nötig.)
3. **Marken-Matching:** Woran wird ein Wing als "Harlem Pace 5 m²" erkannt —
   neues strukturiertes Marke/Modell-Feld im Equipment, oder Auswahl im Profil?
