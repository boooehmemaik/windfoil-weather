/**
 * gear-scoring.test.mjs
 * Systemtest der Material-Logik — Fenster, Quiver, Empfehlung.
 *
 * Auftrag: 3 Fahrer (60/75/95 kg), Skill "intermediate", Gear [6,5,4 m²]
 * Tests: Fenster-Matrix, Monotonie, Foil-Freiheit, Skill-Effekt, Empfehlungs-Sweep,
 *        Randfälle, Feedback-Layer-Smoke, Quiver aus der Herstellertabelle
 *
 * Hieß bis v3.36.0 system-test-foil-removal.mjs und lief damit NIE mit:
 * `npm test` ist `node --test *.test.mjs`. In der Zeit war er außerdem defekt
 * (WF fehlte im vm-Context) — ein Test, den niemand startet, verfällt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import WF from './js/wf-scoring.js';

// ── Sandbox Setup ─────────────────────────────────────────────────────────────
const html = fs.readFileSync('/var/www/windfoil/src/app.jsx', 'utf8');

function extractBlock(startSentinel, endSentinel) {
  const si = html.indexOf(startSentinel);
  const ei = html.indexOf(endSentinel);
  assert(si !== -1, `Sentinel ${startSentinel} nicht gefunden`);
  assert(ei !== -1, `Sentinel ${endSentinel} nicht gefunden`);
  assert(si < ei, 'Sentinels in falscher Reihenfolge');
  return html.slice(si + startSentinel.length, ei);
}

const knToMs = kn => kn / 1.94384;
const msToKn = ms => ms * 1.94384;

// wing-scoring sandbox
// WF gehört in den Context: der Block besteht inzwischen überwiegend aus Aliasen
// auf js/wf-scoring.js. Ohne diese Zeile scheitert er mit „WF is not defined".
const scoringBlock = extractBlock('// <<wing-scoring>>', '// <</wing-scoring>>');
const ctx = vm.createContext({ knToMs, msToKn, Math, console, Date, WF });
vm.runInContext(scoringBlock, ctx);

const {
  calcWindow, wingTableWindow, wingWindow, rangeToWindow, blendWindows,
  scoreHour, scoreDay, bestSession, riderQuiver, bestWingForWind, carries, scorerFor,
  WING_BRANDS, DEFAULT_WING_BRAND, TABLE_BLEND, FEEDBACK_BLEND, FEEDBACK_MIN_SAMPLES
} = ctx;

/** Die Empfehlungskette, wie index.html sie geht → {wing, win, score, gear} | null
 *
 *  Reihenfolge: Quiver → Fenster je Größe → Score → danach die Größe benennen.
 *  Ohne eigenes Material fällt riderQuiver auf den Harlem-Satz zurück; das
 *  anschließende find() ist der Schritt, mit dem die App vom empfohlenen Maß
 *  zurück auf den Eintrag der Materialliste kommt — ohne Eintrag bleibt gear null.
 *
 *  Vorher liefen diese Tests über den Wrapper pickBestSetup, den die App nach
 *  dem Quiver-Umbau nicht mehr aufruft. Ein Test auf toten Code sichert nichts ab. */
function recommend(gearList, weight, skill, windMs) {
  const q = riderQuiver({ weight, skill }, (gearList && gearList.length) ? gearList : null);
  const best = bestWingForWind(q, windMs);
  if (!best) return null;
  return {
    wing: best.wing, win: best.win, score: best.score,
    gear: (gearList || []).find(g => parseFloat(g.wing) === best.wing) || null,
  };
}

// live-boost sandbox
const lbBlock = extractBlock('// <<live-boost>>', '// <</live-boost>>');
const lbCtx = vm.createContext({ knToMs, msToKn, Math, Date, console });
vm.runInContext(lbBlock, lbCtx);
const { applyLiveStationBoost } = lbCtx;

// measured-correction sandbox
const mcBlock = extractBlock('// <<measured-correction>>', '// <</measured-correction>>');
const mcCtx = vm.createContext({ Math, console });
vm.runInContext(mcBlock, mcCtx);
const { applyMeasuredStationCorrection } = mcCtx;

// ── Helpers ───────────────────────────────────────────────────────────────────
const WEIGHTS  = [60, 75, 95];
const WINGS    = [3, 4, 5, 6];
const SKILLS   = ['beginner', 'intermediate', 'advanced', 'pro'];
const QUIVER   = [{ wing: 6.0, planeKn: null }, { wing: 5.0, planeKn: null }, { wing: 4.0, planeKn: null }];
const WIND_KN  = [8, 10, 12, 14, 16, 18, 20, 22, 24, 28];

function fmtKn(ms) { return msToKn(ms).toFixed(1); }

// ═════════════════════════════════════════════════════════════════════════════
// 0. SENTINEL & SIGNATUR-CHECKS
// ═════════════════════════════════════════════════════════════════════════════

test('S0-1 — Sentinel <<wing-scoring>> präsent und calcWindow foil-frei (4 Parameter)', () => {
  // Signatur: calcWindow(weight, wingM2, skill, knownPlaneMs) — kein foil
  assert.equal(calcWindow.length, 4, `calcWindow.length muss 4 sein, got ${calcWindow.length}`);
  // wingWindow ist jetzt ein direkter WF-Alias. Die Parameteranzahl taugt hier
  // nicht mehr als Probe: die kanonische Version zählt 6, weil brandKey und
  // spotWingRange ohne JS-Default stehen. Ein „>= 4" wäre aber keine Zusicherung
  // mehr — geprüft wird deshalb die Signatur selbst.
  const wwSig = Function.prototype.toString.call(wingWindow).match(/\([^)]*\)/)?.[0] ?? '';
  assert.deepStrictEqual(
    wwSig.replace(/[()\s]/g, '').split(','),
    ['weight', 'wingM2', 'skill', 'knownPlaneMs', 'brandKey', 'spotWingRange'],
    `wingWindow-Signatur unerwartet: ${wwSig}`);
  assert.strictEqual(wingWindow, WF.wingWindow,
    'index.html muss WF.wingWindow nutzen, nicht eine eigene Kopie');
  // Gegen das Modul, nicht gegen den Text von index.html: REF_FOIL_TERM wohnt
  // seit der Konsolidierung in wf-scoring.js. Die alte Textprobe suchte im
  // falschen Block und war der einzige rote Test nach der Reanimation.
  assert.equal(typeof WF.REF_FOIL_TERM, 'number', 'REF_FOIL_TERM muss aus WF kommen');
  // Die Signaturprobe muss die echte Funktionsquelle lesen. Vorher wurde ein
  // Regex über index.html gelegt, der nach dem Umzug nie mehr traf — und eine
  // Zusicherung über einen leeren String ist keine Zusicherung.
  const sig = Function.prototype.toString.call(WF.calcWindow).match(/\([^)]*\)/)?.[0] ?? '';
  assert(sig.includes('knownPlaneMs'), `calcWindow-Signatur unerwartet: ${sig}`);
  assert(!sig.includes('foilCm2'), `foilCm2 darf nicht in der calcWindow-Signatur stehen: ${sig}`);
});

test('S0-2 — Alle Blöcke (live-boost, measured-correction) laden ohne Exception', () => {
  assert.equal(typeof applyLiveStationBoost, 'function', 'applyLiveStationBoost muss Funktion sein');
  assert.equal(typeof applyMeasuredStationCorrection, 'function', 'applyMeasuredStationCorrection muss Funktion sein');
  // Die Primitiven, auf denen die Empfehlung aufsetzt — nicht mehr der Wrapper.
  for (const [name, fn] of [['riderQuiver', riderQuiver], ['bestWingForWind', bestWingForWind], ['carries', carries]]) {
    assert.equal(typeof fn, 'function', `${name} muss im wing-scoring-Block verfügbar sein`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. FENSTER-MATRIX — 3×4 (Gewicht × Wing)
// ═════════════════════════════════════════════════════════════════════════════

test('S1 — Fenster-Matrix: wingWindow für alle 3 Gewichte × 4 Wings (intermediate, null)', () => {
  const matrix = {};
  for (const w of WEIGHTS) {
    matrix[w] = {};
    for (const wing of WINGS) {
      const win = wingWindow(w, wing, 'intermediate', null);
      matrix[w][wing] = win;
      // Alle vier Werte müssen endliche Zahlen > 0 sein
      for (const key of ['minWind', 'optMin', 'optMax', 'maxWind']) {
        assert(Number.isFinite(win[key]) && win[key] > 0,
          `wingWindow(${w},${wing}).${key} muss endlich und >0 sein, got ${win[key]}`);
      }
      // Monotone Ordnung: min ≤ optMin ≤ optMax ≤ maxWind
      assert(win.minWind <= win.optMin,   `(${w}kg,${wing}m²): minWind(${win.minWind}) ≤ optMin(${win.optMin})`);
      assert(win.optMin  <= win.optMax,   `(${w}kg,${wing}m²): optMin(${win.optMin}) ≤ optMax(${win.optMax})`);
      assert(win.optMax  <= win.maxWind,  `(${w}kg,${wing}m²): optMax(${win.optMax}) ≤ maxWind(${win.maxWind})`);
    }
  }

  // Console-Ausgabe der Matrix
  console.log('\n=== FENSTER-MATRIX (intermediate, knownPlaneMs=null) ===');
  console.log('weight | wing | minWind | optMin | optMax | maxWind   (alle in kn)');
  console.log('-------+------+---------+--------+--------+---------');
  for (const w of WEIGHTS) {
    for (const wing of WINGS) {
      const win = matrix[w][wing];
      console.log(
        `${String(w).padStart(6)} | ${String(wing).padStart(4)} | ` +
        `${fmtKn(win.minWind).padStart(7)} | ${fmtKn(win.optMin).padStart(6)} | ` +
        `${fmtKn(win.optMax).padStart(6)} | ${fmtKn(win.maxWind).padStart(8)}`
      );
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MONOTONIE-INVARIANTEN
// ═════════════════════════════════════════════════════════════════════════════

test('S2-A — Monotonie Gewicht: Schwerer → höhere Grenzen (alle 4 Wings)', () => {
  for (const wing of WINGS) {
    const w60 = wingWindow(60, wing, 'intermediate', null);
    const w75 = wingWindow(75, wing, 'intermediate', null);
    const w95 = wingWindow(95, wing, 'intermediate', null);

    assert(w60.minWind < w75.minWind,
      `${wing}m²: minWind(60=${fmtKn(w60.minWind)}) muss < minWind(75=${fmtKn(w75.minWind)}) [kn]`);
    assert(w75.minWind < w95.minWind,
      `${wing}m²: minWind(75=${fmtKn(w75.minWind)}) muss < minWind(95=${fmtKn(w95.minWind)}) [kn]`);
    assert(w60.maxWind < w75.maxWind,
      `${wing}m²: maxWind(60=${fmtKn(w60.maxWind)}) muss < maxWind(75=${fmtKn(w75.maxWind)}) [kn]`);
    assert(w75.maxWind < w95.maxWind,
      `${wing}m²: maxWind(75=${fmtKn(w75.maxWind)}) muss < maxWind(95=${fmtKn(w95.maxWind)}) [kn]`);
  }
});

test('S2-B — Monotonie Wing-Größe: Größerer Wing → niedrigere Grenzen (alle 3 Gewichte)', () => {
  for (const w of WEIGHTS) {
    const wins = {};
    for (const wing of WINGS) wins[wing] = wingWindow(w, wing, 'intermediate', null);

    // 3 > 4 > 5 > 6 (alle Grenzen)
    for (let i = 0; i < WINGS.length - 1; i++) {
      const big = WINGS[i], small = WINGS[i + 1];
      assert(wins[small].minWind < wins[big].minWind,
        `${w}kg: minWind(${small}m²=${fmtKn(wins[small].minWind)}) muss < minWind(${big}m²=${fmtKn(wins[big].minWind)}) [kn]`);
      assert(wins[small].maxWind < wins[big].maxWind,
        `${w}kg: maxWind(${small}m²=${fmtKn(wins[small].maxWind)}) muss < maxWind(${big}m²=${fmtKn(wins[big].maxWind)}) [kn]`);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. FOIL-UNABHÄNGIGKEIT
// ═════════════════════════════════════════════════════════════════════════════

test('S3-A — Signatur foil-frei: calcWindow(w,wing,skill,null) kein 5. Parameter nötig', () => {
  // Keine Exception bei 4 Argumenten
  const result = calcWindow(80, 5, 'intermediate', null);
  assert(Number.isFinite(result.minWind), 'calcWindow(4 args) muss funktionieren');
  assert(Number.isFinite(result.maxWind), 'maxWind muss endlich sein');
});

test('S3-B — Foil-Unabhängigkeit numerisch: calcWindow(w,wing,skill,null) == alter foil=1800-Wert', () => {
  // Für alle 3 Gewichte × alle 4 Wings prüfen
  for (const weight of WEIGHTS) {
    for (const wing of WINGS) {
      const cw = calcWindow(weight, wing, 'intermediate', null);
      // Reproduktion der alten Formel: REF_FOIL_TERM=0.8, foilF=1800/1800=1
      const load = weight / wing;
      const sMin = 1.25; // intermediate
      const minW_raw = Math.max(2.5, (3.5 + load * 0.15 + 0.8) * sMin * 0.85);
      const expectedMin = Math.round(minW_raw * 10) / 10;
      assert.equal(cw.minWind, expectedMin,
        `calcWindow(${weight},${wing}): minWind ${cw.minWind} != erwartet ${expectedMin} (foil=1800-Äquivalent)`);
    }
  }
});

test('S3-C — Empfehlung ohne foil-Feld in Gear-Objekten: keine Exception, sinnvolles Ergebnis', () => {
  const gear = [{ wing: 6.0 }, { wing: 5.0 }, { wing: 4.0 }]; // kein .foil, kein .planeKn
  const result = recommend(gear, 80, 'intermediate', knToMs(15));
  assert(result !== null, 'Empfehlung muss Ergebnis liefern');
  assert(Number.isFinite(result.score), `score muss endlich sein, got ${result.score}`);
  assert(result.gear !== null, 'der Eintrag der Materialliste muss gefunden werden');
  assert(Number.isFinite(parseFloat(result.gear.wing)), 'wing muss parseable sein');
  // Empfohlen werden darf nur, was in der Tasche liegt.
  assert([4, 5, 6].includes(result.wing), `Empfehlung ${result.wing} liegt nicht in der Tasche`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. SKILL WIRKT WEITER
// ═════════════════════════════════════════════════════════════════════════════

test('S4 — Skill-Monotonie: maxWind(beginner) < intermediate < advanced < pro', () => {
  for (const weight of WEIGHTS) {
    for (const wing of WINGS) {
      const maxBySkill = SKILLS.map(sk => calcWindow(weight, wing, sk, null).maxWind);
      for (let i = 0; i < maxBySkill.length - 1; i++) {
        assert(maxBySkill[i] < maxBySkill[i + 1],
          `${weight}kg ${wing}m²: maxWind(${SKILLS[i]}=${fmtKn(maxBySkill[i])}) muss < maxWind(${SKILLS[i+1]}=${fmtKn(maxBySkill[i+1])}) [kn]`);
      }
    }
  }
});

test('S4-wingWindow — Skill-Effekt in wingWindow (blended): beginner.maxWind < pro.maxWind', () => {
  for (const weight of WEIGHTS) {
    for (const wing of WINGS) {
      const beginner = wingWindow(weight, wing, 'beginner', null).maxWind;
      const pro      = wingWindow(weight, wing, 'pro', null).maxWind;
      assert(beginner < pro,
        `wingWindow(${weight},${wing}): beginner.maxWind(${fmtKn(beginner)}) muss < pro.maxWind(${fmtKn(pro)}) [kn]`);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. EMPFEHLUNGS-SWEEP (Quiver-Kette) — alle 3 Fahrer
// ═════════════════════════════════════════════════════════════════════════════

test('S5 — Empfehlungs-Sweep: Ausgabe-Matrix + Monotonie-Check (Wing fällt mit Wind)', () => {
  console.log('\n=== EMPFEHLUNGS-SWEEP (Gear: 6/5/4 m², intermediate) ===');

  for (const weight of WEIGHTS) {
    console.log(`\n--- Fahrer ${weight} kg ---`);
    console.log('Wind [kn] | Empfehlung [m²] | Score');
    console.log('----------+-----------------+------');

    let prevWing = Infinity;

    for (const windKn of WIND_KN) {
      const windMs = knToMs(windKn);
      const best = recommend(QUIVER, weight, 'intermediate', windMs);
      assert(best !== null, `recommend(${weight}kg, ${windKn}kn) darf nicht null sein`);
      assert(Number.isFinite(best.score), `Score bei ${windKn}kn muss endlich sein`);
      assert(best.score >= 0, `Score muss >= 0 sein, got ${best.score}`);
      assert(best.gear !== null, `bei ${windKn}kn muss die Empfehlung aus der Tasche kommen`);

      const recWing = parseFloat(best.gear.wing);
      console.log(
        `${String(windKn).padStart(9)} | ${String(recWing).padStart(15)} | ${best.score}`
      );

      // Hart, nicht als Log-Warnung: vorher stand hier ein console.log, und ein
      // Lauf, der nichts durchfallen lässt, meldet den Fall nicht — er protokolliert ihn.
      assert(recWing <= prevWing,
        `${weight}kg: bei ${windKn}kn wurde von ${prevWing} auf ${recWing} m² hochgegriffen`);
      prevWing = recWing;
    }

    // Feinraster: die 2-kn-Schritte der Tabelle oben überspringen die Gleichstands-
    // bänder größtenteils. Geprüft wird hier die Monotonie über das ganze Band —
    // NICHT die Mittigkeitsregel selbst: der Quiver ist aufsteigend sortiert, und
    // ohne Tiebreak gewinnt dann die kleinste gleichwertige Größe, was die Monotonie
    // zufällig intakt lässt (nachgemessen: Mutation überlebt hier). Dass bei
    // Gleichstand die mittigste Größe kommt, ist in quiver.test.mjs festgenagelt.
    let prevFine = Infinity, ties = 0;
    for (let kn = 6; kn <= 30; kn += 0.25) {
      const ms = knToMs(kn);
      const q = riderQuiver({ weight, skill: 'intermediate' }, QUIVER);
      if (q.filter(x => scoreHour(ms, x.win) === 100).length > 1) ties++;
      const wing = bestWingForWind(q, ms).wing;
      assert(wing <= prevFine,
        `${weight}kg: bei ${kn.toFixed(2)}kn wurde von ${prevFine} auf ${wing} m² hochgegriffen`);
      prevFine = wing;
    }
    assert(ties > 0, `Fixture nutzlos: bei ${weight}kg gibt es im Feinraster keinen Gleichstand auf 100`);

    // Und die Spannweite muss tatsächlich genutzt werden — sonst wäre die
    // Monotonie trivial erfüllt, indem überall dasselbe Wing empfohlen wird.
    const best8  = recommend(QUIVER, weight, 'intermediate', knToMs(8));
    const best28 = recommend(QUIVER, weight, 'intermediate', knToMs(28));
    assert(best8.wing > best28.wing,
      `${weight}kg: bei 8kn (${best8.wing}m²) muss ein größeres Wing kommen als bei 28kn (${best28.wing}m²)`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. RANDFÄLLE
// ═════════════════════════════════════════════════════════════════════════════

test('S6-A — Extremwinde scoreHour: < 10kn und > 32kn → kein NaN, >= 0', () => {
  const win = wingWindow(80, 5, 'intermediate', null);
  const extremes = [knToMs(1), knToMs(3), knToMs(5), knToMs(8),
                    knToMs(33), knToMs(40), knToMs(50)];
  for (const w of extremes) {
    const s = scoreHour(w, win);
    assert(!Number.isNaN(s), `scoreHour(${msToKn(w).toFixed(1)}kn) darf nicht NaN sein`);
    assert(s >= 0, `scoreHour(${msToKn(w).toFixed(1)}kn) muss >= 0 sein, got ${s}`);
  }
});

test('S6-B — Wing 2m² und 7m²: wingTableWindow outOfRange, wingWindow fällt auf calcWindow zurück', () => {
  const r2 = wingTableWindow(80, 2);
  const r7 = wingTableWindow(80, 7);
  assert(r2.outOfRange === true,  'wingTableWindow(80,2).outOfRange muss true sein');
  assert(r7.outOfRange === true,  'wingTableWindow(80,7).outOfRange muss true sein');
  assert(typeof r2.reason === 'string' && r2.reason.length > 0, '2m² muss reason haben');
  assert(typeof r7.reason === 'string' && r7.reason.length > 0, '7m² muss reason haben');

  // wingWindow muss auf calcWindow fallen (outOfRange → Blend-Bypass)
  const ww2 = wingWindow(80, 2, 'intermediate', null);
  const cw2 = calcWindow(80, 2, 'intermediate', null);
  assert.deepEqual(ww2, cw2, 'wingWindow(80,2) muss identisch zu calcWindow(80,2) sein (Bypass)');

  const ww7 = wingWindow(80, 7, 'intermediate', null);
  const cw7 = calcWindow(80, 7, 'intermediate', null);
  assert.deepEqual(ww7, cw7, 'wingWindow(80,7) muss identisch zu calcWindow(80,7) sein (Bypass)');
});

test('S6-C — leere/null Materialliste → Harlem-Satz als Default, nicht null', () => {
  // Hier hat sich der Vertrag mit v3.36.0 geändert, und das ist der Kern des
  // Features: wer kein Material einträgt, bekommt keine leere Antwort mehr,
  // sondern den vollen Harlem-Satz als Annahme. Der alte Wrapper lieferte null.
  for (const empty of [[], null]) {
    const r = recommend(empty, 80, 'intermediate', knToMs(15));
    assert(r !== null, `Materialliste ${JSON.stringify(empty)} muss auf den Default fallen`);
    assert(Number.isFinite(r.score), 'Score muss endlich sein');
    assert.equal(r.gear, null, 'ohne eigenes Material gibt es keinen Listeneintrag');
    const sizes = WING_BRANDS[DEFAULT_WING_BRAND].sizes;
    assert(r.wing in sizes || Object.keys(sizes).map(Number).includes(r.wing),
      `Empfehlung ${r.wing} m² gehört nicht zum Default-Satz ${Object.keys(sizes).join('/')}`);
  }
  // Der Default muss alle Größen der Herstellertabelle umfassen — sonst wäre das
  // „volle Tasche"-Versprechen nur eine andere Einzelgröße.
  const q = riderQuiver({ weight: 80, skill: 'intermediate' }, null);
  assert.deepStrictEqual(q.map(x => x.wing).sort((a, b) => a - b),
    Object.keys(WING_BRANDS[DEFAULT_WING_BRAND].sizes).map(Number).sort((a, b) => a - b),
    'Default-Quiver muss genau die Größen der Herstellertabelle führen');
});

test('S6-D — scoreDay mit Extremwind-Array: kein NaN, in [0,100]', () => {
  const win = wingWindow(80, 5, 'intermediate', null);
  for (const kn of [3, 8, 15, 20, 32, 40]) {
    const winds = Array.from({ length: 24 }, () => knToMs(kn));
    const s = scoreDay(winds, win, 0);
    assert(!Number.isNaN(s), `scoreDay(@${kn}kn) darf nicht NaN sein`);
    assert(s >= 0 && s <= 100, `scoreDay(@${kn}kn) muss in [0,100] sein, got ${s}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. FEEDBACK-/KORREKTUR-SCHICHTEN SMOKE-TEST
// ═════════════════════════════════════════════════════════════════════════════

test('S7-A — Feedback spotWingRange blendet korrekt (beide Enden)', () => {
  const spotWingRange = { minKn: 10, maxKn: 22, samples: 2 };
  const withFb    = wingWindow(95, 6, 'intermediate', null, 'Harlem Pace', spotWingRange);
  const withoutFb = wingWindow(95, 6, 'intermediate', null);

  // Mit Feedback ≠ ohne Feedback
  assert.notDeepEqual(withFb, withoutFb, 'Feedback muss Ergebnis ändern');

  // Manuelle Berechnung
  const phys = calcWindow(95, 6, 'intermediate', null);
  const tab  = wingTableWindow(95, 6);
  const base = blendWindows(phys, tab, 0.5);
  const fb   = rangeToWindow(10, 22);
  const expected = blendWindows(base, fb, 0.5);
  assert.deepEqual(withFb, expected, 'Feedback-Blend muss blendWindows(base,fb,0.5) sein');
});

test('S7-B — Feedback mit spotWingRange hoch (25/30kn) → minWind höher als ohne', () => {
  const spotWingRange = { minKn: 25, maxKn: 30, samples: 1 };
  const withFb    = wingWindow(95, 4, 'intermediate', null, 'Harlem Pace', spotWingRange);
  const withoutFb = wingWindow(95, 4, 'intermediate', null);
  assert(withFb.minWind > withoutFb.minWind,
    `Hohes Feedback: minWind mit Fb (${fmtKn(withFb.minWind)}kn) muss > ohne Fb (${fmtKn(withoutFb.minWind)}kn)`);
});

test('S7-C — live-boost Smoke: gültiger Live-Eintrag boosted Nachmittagsstunden', () => {
  const modelW = knToMs(7.6);
  const wins24 = Array.from({ length: 24 }, () => modelW);
  const gust24 = Array.from({ length: 24 }, () => modelW * 1.3);
  const live = { ok: true, wind: knToMs(15), time: '14:00', sensorOk: true, label: 'Talamone' };
  const result = applyLiveStationBoost(wins24, gust24, live, true);
  assert.equal(result.applied, true, 'Live-Boost muss aktiv sein');
  assert(result.wins[14] > modelW * 1.9, 'Nachmittag (h14) muss deutlich erhöht sein');
});

test('S7-D — measured-correction Smoke: Anhebung wo Station > Modell', () => {
  const modelW = knToMs(8);
  const stationW = knToMs(12);
  const wins = Array.from({ length: 24 }, () => modelW);
  const mwind = Array.from({ length: 24 }, () => stationW);
  const measured = {
    ok: true, hourly: { wind: mwind, gust: [] },
    date: '2026-08-03', km: 0, label: 'Talamone'
  };
  const result = applyMeasuredStationCorrection(wins, null, measured, '2026-08-03');
  assert.equal(result.applied, true, 'Measured-Correction muss aktiv sein');
  const expected = Math.round((modelW + (stationW - modelW) * 0.8) * 100) / 100;
  assert(Math.abs(result.wins[12] - expected) < 0.001,
    `wins[12] soll ${expected} sein, got ${result.wins[12]}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. HEUTIGE REAL-BEDINGUNGEN TALAMONE — 6.0-VERDICT FÜR 95 KG
// ═════════════════════════════════════════════════════════════════════════════

test('S8 — Talamone heute (2026-08-03): 6.0-Verdikt für 95 kg', () => {
  const TODAY = '2026-08-03';
  const WEIGHT = 95;
  const SKILL  = 'intermediate';
  const GEAR_95 = [{ wing: 6.0, planeKn: null }, { wing: 5.0, planeKn: null }, { wing: 4.0, planeKn: null }];

  // Open-Meteo Forecast für Talamone heute (bereits abgerufen, inline als Konstante)
  const forecastWindMs = [
    0.10, 0.58, 0.85, 0.94, 1.08, 1.03, 1.03, 0.94, 0.76, 0.72,
    1.46, 2.40, 3.06, 3.45, 3.55, 3.36, 3.25, 3.22, 2.90, 2.20,
    1.36, 0.61, 0.85, 1.00
  ];
  const forecastGustMs = [
    0.60, 0.60, 0.90, 1.40, 1.60, 1.60, 1.60, 1.50, 1.40, 1.70,
    2.90, 4.30, 5.20, 5.80, 6.00, 5.90, 5.80, 5.80, 5.80, 5.10,
    3.90, 2.30, 1.40, 1.60
  ];

  // Live-Station-Daten (abgerufen: 13:49 Uhr, wind=4.47 m/s, sensorOk=true)
  const liveData = {
    ok: true, sensorOk: true,
    wind: 4.47, gust: 4.47, gustMax: 4.92,
    time: '13:49', label: 'Talamone (Baia di Talamone)'
  };

  // Kein measured-Station-Eintrag für heute (no_measured_station)
  const measuredData = null;

  // Schritt 1: Live-Boost anwenden (heute = true)
  const boosted = applyLiveStationBoost(forecastWindMs, forecastGustMs, liveData, true);

  // Schritt 2: Measured-Correction (none today)
  // kein Aufruf nötig, measuredData = null

  const finalWins = boosted.wins;
  const finalGust = boosted.gust;

  // Ausgabe: Nachmittags-Windprofil
  console.log('\n=== TALAMONE 2026-08-03 — Windprofil (95 kg, intermediate) ===');
  console.log('Stunde | Forecast [kn] | Nach LiveBoost [kn] | Gust [kn]');
  console.log('-------+---------------+--------------------+----------');
  for (let h = 9; h <= 20; h++) {
    const fc = msToKn(forecastWindMs[h]).toFixed(1);
    const lb = msToKn(finalWins[h]).toFixed(1);
    const gu = finalGust ? msToKn(finalGust[h]).toFixed(1) : '-';
    console.log(`${String(h).padStart(6)} | ${fc.padStart(13)} | ${lb.padStart(18)} | ${gu.padStart(8)}`);
  }

  // Live-Boost-Status
  console.log(`\nLive-Boost: applied=${boosted.applied}, k=${boosted.k ?? 'n/a'}, station=${boosted.station ?? 'n/a'}`);

  // Stunden-Scores für Gear [6,5,4] im Nachmittag
  console.log('\n=== STUNDEN-SCORES je Wing (h 9..19) ===');
  console.log('Stunde |  6.0 m²  |  5.0 m²  |  4.0 m²  | Empfehlung');
  console.log('-------+----------+----------+----------+-----------');

  const win6 = wingWindow(WEIGHT, 6, SKILL, null);
  const win5 = wingWindow(WEIGHT, 5, SKILL, null);
  const win4 = wingWindow(WEIGHT, 4, SKILL, null);

  for (let h = 9; h <= 19; h++) {
    const w = finalWins[h];
    const s6 = scoreHour(w, win6);
    const s5 = scoreHour(w, win5);
    const s4 = scoreHour(w, win4);
    const best = s6 >= s5 && s6 >= s4 ? '6.0' : s5 >= s4 ? '5.0' : '4.0';
    console.log(
      `${String(h).padStart(6)} | ${String(s6).padStart(8)} | ${String(s5).padStart(8)} | ` +
      `${String(s4).padStart(8)} | ${best}`
    );
  }

  // Tages-Score (bestSession) je Wing
  const dayScore6 = scoreDay(finalWins, win6, 0);
  const dayScore5 = scoreDay(finalWins, win5, 0);
  const dayScore4 = scoreDay(finalWins, win4, 0);

  console.log(`\nTages-Score (beste 4h): 6.0 m² = ${dayScore6} | 5.0 m² = ${dayScore5} | 4.0 m² = ${dayScore4}`);

  // Empfehlung für den repräsentativen Nachmittagswind (h14, Peak-Stunde)
  const peakWind = finalWins[14];
  const bestPeak = recommend(GEAR_95, WEIGHT, SKILL, peakWind);
  console.log(`\nEmpfehlung @Peak h14 (${msToKn(peakWind).toFixed(1)}kn): ${bestPeak.wing} m² (Score ${bestPeak.score})`);

  // Mittelwind 11–17 Uhr
  const afternoonHours = [11,12,13,14,15,16,17];
  const avgWind = finalWins.filter((_,h) => afternoonHours.includes(h))
                            .reduce((a,b) => a+b, 0) / afternoonHours.length;
  const bestAvg = recommend(GEAR_95, WEIGHT, SKILL, avgWind);
  console.log(`Empfehlung @Avg Nachmittag (${msToKn(avgWind).toFixed(1)}kn): ${bestAvg.wing} m² (Score ${bestAvg.score})`);

  // Verdikt
  const verdict6 = dayScore6 >= dayScore5 && dayScore6 >= dayScore4 ? 'JA' : 'NEIN';
  console.log(`\n=== 6.0-VERDIKT FÜR HEUTE ===`);
  console.log(`Ist 6.0 m² die beste Wahl für 95 kg? → ${verdict6}`);
  console.log(`Wind Nachmittag: Forecast ~${msToKn(forecastWindMs[14]).toFixed(1)} kn,` +
    ` nach Live-Boost ~${msToKn(finalWins[14]).toFixed(1)} kn`);
  console.log(`Gesamt-Score: 6.0=${dayScore6} / 5.0=${dayScore5} / 4.0=${dayScore4}`);

  // Assertions
  assert(!Number.isNaN(dayScore6), 'dayScore6 darf nicht NaN sein');
  assert(!Number.isNaN(dayScore5), 'dayScore5 darf nicht NaN sein');
  assert(!Number.isNaN(dayScore4), 'dayScore4 darf nicht NaN sein');
  assert(dayScore6 >= 0 && dayScore6 <= 100, `dayScore6 muss in [0,100] liegen, got ${dayScore6}`);

  // Die exakte Zusicherung des Quiver-Umbaus: der Stunden-Score der Tasche IST
  // das Maximum der Einzelgrößen — nicht ihre Summe, nicht die erste Größe.
  // Eine Tagesschranke „<= 100" taugt dafür nicht: an diesem schwachwindigen Tag
  // käme auch eine Summe nur auf 81 und rutschte unter der Schranke durch.
  const q95 = riderQuiver({ weight: WEIGHT, skill: SKILL }, GEAR_95);
  const quiverScoreAt = scorerFor(q95);
  let hoursWithOverlap = 0;
  for (let h = 9; h <= 19; h++) {
    const w = finalWins[h];
    const singles = [scoreHour(w, win6), scoreHour(w, win5), scoreHour(w, win4)];
    assert.strictEqual(quiverScoreAt(w), Math.max(...singles),
      `Stunde ${h} (${msToKn(w).toFixed(1)}kn): Quiver ${quiverScoreAt(w)} != Maximum ${Math.max(...singles)} aus [${singles}]`);
    if (singles.filter(s => s > 0).length > 1) hoursWithOverlap++;
  }
  // Ohne überlappende Stunden wäre „Maximum == Summe" und der Test blind.
  assert(hoursWithOverlap > 0,
    'Fixture nutzlos: keine Stunde, in der mehr als eine Größe punktet — Maximum und Summe wären identisch');

  const quiverDay = scoreDay(finalWins, q95, 0);
  const bestSingle = Math.max(dayScore6, dayScore5, dayScore4);
  console.log(`Quiver-Tagesscore: ${quiverDay} (beste Einzelgröße: ${bestSingle}, ${hoursWithOverlap} Überlappungsstunden)`);
  assert(quiverDay >= bestSingle,
    `Quiver (${quiverDay}) darf nicht unter der besten Einzelgröße (${bestSingle}) liegen`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. EMPFEHLUNGS-INVARIANTEN (foil-frei)
// ═════════════════════════════════════════════════════════════════════════════

test('S9 — Empfehlung: kein g.foil Zugriff nötig (Gear ohne foil-Feld)', () => {
  // Gear-Objekte haben bewusst kein .foil-Feld — das ist der v3.14.0-Zustand
  const gearNoFoil = [
    { wing: 6.0 },
    { wing: 5.0 },
    { wing: 4.0 },
  ];
  let threw = false;
  let result;
  try {
    result = recommend(gearNoFoil, 95, 'intermediate', knToMs(14));
  } catch (e) {
    threw = true;
    console.log('FEHLER in der Empfehlungskette ohne foil:', e.message);
  }
  assert(!threw, 'die Empfehlungskette darf ohne foil-Feld nicht crashen');
  assert(result !== null, 'Ergebnis muss vorhanden sein');
  assert([4, 5, 6].includes(parseFloat(result.gear.wing)), `Empfohlenes Wing muss 4/5/6 sein, got ${result.gear.wing}`);
});

test('S9-B — wingWindow planeKn-Bypass: mit planeKn=18kn ignoriert Feedback-Layer', () => {
  const planeMs = knToMs(18);
  const spotWingRange = { minKn: 25, maxKn: 32, samples: 10 };
  const withBypass = wingWindow(80, 5, 'intermediate', planeMs, 'Harlem Pace', spotWingRange);
  const physExpect = calcWindow(80, 5, 'intermediate', planeMs);
  assert.deepEqual(withBypass, physExpect,
    'knownPlaneMs > 0: Bypass muss greifen; Feedback-Layer wird ignoriert');
});
