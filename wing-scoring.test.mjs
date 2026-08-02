/**
 * wing-scoring.test.mjs
 * Phase 5 Tests — Harlem-Pace-Integration (DESIGN.md TESTPLAN Fälle 1–7)
 *
 * Ansatz: index.html lesen, Block zwischen // <<wing-scoring>> und // <</wing-scoring>>
 * extrahieren, in vm-Sandbox ausführen. Sandbox stellt knToMs/msToKn bereit.
 * Dann Funktionen herausziehen und asserten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

// ── Setup: extract scoring block from index.html ──────────────────────────────
const html = fs.readFileSync('/var/www/windfoil/index.html', 'utf8');
const startMarker = '// <<wing-scoring>>';
const endMarker   = '// <</wing-scoring>>';
const startIdx = html.indexOf(startMarker);
const endIdx   = html.indexOf(endMarker);
assert(startIdx !== -1, 'Sentinel <<wing-scoring>> nicht gefunden in index.html');
assert(endIdx   !== -1, 'Sentinel <</wing-scoring>> nicht gefunden in index.html');
assert(startIdx < endIdx, 'Sentinels in falscher Reihenfolge');

const scoringBlock = html.slice(startIdx + startMarker.length, endIdx);

// ── Sandbox context ───────────────────────────────────────────────────────────
const knToMs = kn => kn / 1.94384;
const msToKn = ms => ms * 1.94384;

const ctx = vm.createContext({
  knToMs,
  msToKn,
  Math,
  console,
  // expose anything else the block might need
});

vm.runInContext(scoringBlock, ctx);

const {
  calcWindow,
  wingTableWindow,
  wingWindow,
  scoreHour,
  scoreDay,
  bestSession,
  WING_BRANDS,
  DEFAULT_WING_BRAND,
  TABLE_BLEND,
} = ctx;

// ── Helper ────────────────────────────────────────────────────────────────────
const approx = (actual, expected, tol, msg) => {
  assert(
    Math.abs(actual - expected) <= tol,
    `${msg}: expected ≈${expected} (±${tol}), got ${actual}`
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Fall 1 — Gewicht niedrig/mittel/hoch × alle vier Stufen
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 1a — wingTableWindow Referenzgewicht 78kg, alle Stufen (3/4/5/6 m²)', () => {
  const cases = [
    { size: 3, minKn: 20, maxKn: 32 },
    { size: 4, minKn: 16, maxKn: 28 },
    { size: 5, minKn: 14, maxKn: 26 },
    { size: 6, minKn: 10, maxKn: 22 },
  ];
  for (const c of cases) {
    const w = wingTableWindow(78, c.size);
    assert(!w.outOfRange, `${c.size}m² sollte in Range sein`);
    approx(w.minWind, knToMs(c.minKn), 0.05, `${c.size}m² minWind @78kg`);
    approx(w.maxWind, knToMs(c.maxKn), 0.05, `${c.size}m² maxWind @78kg`);
  }
});

test('Fall 1b — Monotonie: Schwererer Fahrer → höhere Grenzen (95kg > 78kg > 60kg)', () => {
  for (const size of [3, 4, 5, 6]) {
    const light  = wingTableWindow(60, size);
    const ref    = wingTableWindow(78, size);
    const heavy  = wingTableWindow(95, size);
    assert(!light.outOfRange && !ref.outOfRange && !heavy.outOfRange,
      `Größe ${size}m² sollte in Range sein`);
    assert(heavy.minWind > ref.minWind,
      `${size}m²: 95kg minWind (${heavy.minWind}) muss > 78kg (${ref.minWind})`);
    assert(ref.minWind > light.minWind,
      `${size}m²: 78kg minWind (${ref.minWind}) muss > 60kg (${light.minWind})`);
    assert(heavy.maxWind > ref.maxWind,
      `${size}m²: 95kg maxWind (${heavy.maxWind}) muss > 78kg (${ref.maxWind})`);
    assert(ref.maxWind > light.maxWind,
      `${size}m²: 78kg maxWind (${ref.maxWind}) muss > 60kg (${light.maxWind})`);
  }
});

test('Fall 1c — √-Faktor exakt: 3m², 95kg → minWind ≈ 20kn × √(95/78) (±0.1 kn)', () => {
  const w = wingTableWindow(95, 3);
  assert(!w.outOfRange, '3m² @95kg sollte in Range sein');
  const f = Math.sqrt(95 / 78);
  const expectedMinKn = 20 * f;
  const expectedMaxKn = 32 * f;
  approx(msToKn(w.minWind), expectedMinKn, 0.1, '3m² @95kg minWind in kn');
  approx(msToKn(w.maxWind), expectedMaxKn, 0.1, '3m² @95kg maxWind in kn');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 2 — Interpolation Zwischengröße 4.5 m²
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 2 — wingTableWindow(78, 4.5) = Mittel aus 4m² und 5m²', () => {
  const w = wingTableWindow(78, 4.5);
  assert(!w.outOfRange, '4.5m² sollte in Range sein');
  // min: (16+14)/2 = 15 kn; max: (28+26)/2 = 27 kn
  const expectedMinKn = 15;
  const expectedMaxKn = 27;
  approx(msToKn(w.minWind), expectedMinKn, 0.1, '4.5m² minWind in kn');
  approx(msToKn(w.maxWind), expectedMaxKn, 0.1, '4.5m² maxWind in kn');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 3 — Stufengrenzen-Wind: scoreHour monoton fallend jenseits optMax
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 3 — scoreHour monoton fallend jenseits optMax bei 5m² und 4m²', () => {
  // Test with wingWindow(78, size, 1800, "intermediate", null)
  for (const size of [4, 5]) {
    const win = wingWindow(78, size, 1800, 'intermediate', null);
    // sample winds just past optMax and increasing
    const winds = [win.optMax + 0.5, win.optMax + 1.0, win.optMax + 2.0,
                   win.optMax + 3.0, win.optMax + 5.0, win.optMax + 7.0];
    let prevScore = scoreHour(win.optMax, win); // = 100 at optMax
    let prevWind  = win.optMax;
    for (const w of winds) {
      const sc = scoreHour(w, win);
      assert(!Number.isNaN(sc), `scoreHour(${w}, win${size}) darf nicht NaN sein`);
      assert(sc >= 0, `scoreHour(${w}, win${size}) muss >= 0 sein`);
      assert(sc <= prevScore,
        `scoreHour(${w}) = ${sc} muss <= scoreHour(${prevWind}) = ${prevScore} (monoton fallend, ${size}m²)`);
      prevScore = sc;
      prevWind  = w;
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 4 — Außerhalb Gesamtrange: 5 kn und 40 kn → kein NaN, Score >= 0
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 4 — scoreHour bei Wind 5 kn und 40 kn: kein NaN, kein Exception, >= 0', () => {
  const win = wingWindow(78, 5, 1800, 'intermediate', null);
  const lowW  = knToMs(5);
  const highW = knToMs(40);
  const scoreLow  = scoreHour(lowW,  win);
  const scoreHigh = scoreHour(highW, win);
  assert(!Number.isNaN(scoreLow),  `scoreHour(5kn) = ${scoreLow}: darf nicht NaN sein`);
  assert(!Number.isNaN(scoreHigh), `scoreHour(40kn) = ${scoreHigh}: darf nicht NaN sein`);
  assert(scoreLow  >= 0, `scoreHour(5kn) muss >= 0 sein, got ${scoreLow}`);
  assert(scoreHigh >= 0, `scoreHour(40kn) muss >= 0 sein, got ${scoreHigh}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 5 — Wing außerhalb 3–6 m²: outOfRange + Blend-Bypass
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 5 — wingTableWindow(78, 2) und (78, 7): outOfRange:true mit reason', () => {
  const r2 = wingTableWindow(78, 2);
  const r7 = wingTableWindow(78, 7);
  assert(r2.outOfRange === true,  'wingTableWindow(78,2).outOfRange muss true sein');
  assert(r7.outOfRange === true,  'wingTableWindow(78,7).outOfRange muss true sein');
  assert(typeof r2.reason === 'string' && r2.reason.length > 0, '2m² muss reason haben');
  assert(typeof r7.reason === 'string' && r7.reason.length > 0, '7m² muss reason haben');
});

test('Fall 5 — wingWindow(78, 2, ...) === calcWindow(78, 2, ...) (Blend-Bypass)', () => {
  const foil = 1800, skill = 'intermediate';
  const ww = wingWindow(78, 2, foil, skill, null);
  const cw = calcWindow(78, 2, foil, skill, null);
  assert.deepEqual(ww, cw, 'Wing 2m²: wingWindow muss identisch zu calcWindow sein (Bypass)');
});

test('Fall 5 — wingWindow(78, 7, ...) === calcWindow(78, 7, ...) (Blend-Bypass)', () => {
  const foil = 1800, skill = 'intermediate';
  const ww = wingWindow(78, 7, foil, skill, null);
  const cw = calcWindow(78, 7, foil, skill, null);
  assert.deepEqual(ww, cw, 'Wing 7m²: wingWindow muss identisch zu calcWindow sein (Bypass)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 6 — Regression Foil/Kalibrierung
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 6a — wingWindow mit knownPlaneMs=6.0 deep-equal calcWindow (Bypass)', () => {
  const foil = 1800, skill = 'intermediate', planeMs = 6.0;
  const ww = wingWindow(80, 5, foil, skill, planeMs);
  const cw = calcWindow(80, 5, foil, skill, planeMs);
  assert.deepEqual(ww, cw, 'kalibrierte Planing-Schwelle: wingWindow muss == calcWindow sein');
});

test('Fall 6b — Foil-Variation verändert calcWindow-Ergebnis', () => {
  const skill = 'intermediate';
  const cw1 = calcWindow(80, 5, 1800, skill, null);
  const cw2 = calcWindow(80, 5, 1200, skill, null);
  // Kleinerer Foil (1200cm²) → höheres minWind (foilF = 1800/foilCm2 steigt)
  assert(cw2.minWind > cw1.minWind,
    `Foil 1200cm² (${cw2.minWind}) muss höheres minWind als 1800cm² (${cw1.minWind}) ergeben`);
  assert(cw2.maxWind > cw1.maxWind,
    `Foil 1200cm² (${cw2.maxWind}) muss höheres maxWind als 1800cm² (${cw1.maxWind}) ergeben`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 7 — E2E-Sweep Gialova: Plausibilitäts-Szenarien
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 7 — E2E-Sweep Gialova: schwach < ideal, stark < ideal, ideal nahe 100', () => {
  const win = wingWindow(80, 5, 1800, 'intermediate', null);

  // Helpers to build a 24h wind series (hours 0..23) all at same speed
  const makeWinds = (speedMs) => Array.from({ length: 24 }, (_, h) => speedMs);

  // Weak wind ~8 kn ≈ 4.1 m/s
  const weakMs  = knToMs(8);
  // Ideal wind ~18 kn ≈ 9.3 m/s
  const idealMs = knToMs(18);
  // Strong wind ~30 kn ≈ 15.4 m/s
  const strongMs = knToMs(30);

  const scoreWeak   = scoreDay(makeWinds(weakMs),   win, 0);
  const scoreIdeal  = scoreDay(makeWinds(idealMs),  win, 0);
  const scoreStrong = scoreDay(makeWinds(strongMs), win, 0);

  assert(!Number.isNaN(scoreWeak),   `scoreDay (schwach) darf nicht NaN sein`);
  assert(!Number.isNaN(scoreIdeal),  `scoreDay (ideal) darf nicht NaN sein`);
  assert(!Number.isNaN(scoreStrong), `scoreDay (stark) darf nicht NaN sein`);

  assert(scoreWeak  < scoreIdeal,
    `Schwach (${scoreWeak}) muss < Ideal (${scoreIdeal})`);
  assert(scoreStrong < scoreIdeal,
    `Stark (${scoreStrong}) muss < Ideal (${scoreIdeal})`);
  assert(scoreIdeal >= 80,
    `Ideal-Score (${scoreIdeal}) muss nahe 100 sein (≥80)`);
});

test('Fall 7 — Alle Szenarien: kein NaN, kein Exception', () => {
  const win = wingWindow(80, 5, 1800, 'intermediate', null);
  const makeWinds = (speedMs) => Array.from({ length: 24 }, () => speedMs);

  for (const kn of [5, 8, 12, 16, 18, 22, 26, 30, 35, 40]) {
    const w = knToMs(kn);
    const s = scoreDay(makeWinds(w), win, 0);
    assert(!Number.isNaN(s), `scoreDay @ ${kn}kn darf nicht NaN sein`);
    assert(s >= 0 && s <= 100, `scoreDay @ ${kn}kn muss in [0,100] sein, got ${s}`);
  }
});
