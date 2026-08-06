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
  rangeToWindow,
  blendWindows,
  scoreHour,
  scoreDay,
  bestSession,
  WING_BRANDS,
  DEFAULT_WING_BRAND,
  TABLE_BLEND,
  FEEDBACK_BLEND,
  FEEDBACK_MIN_SAMPLES,
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
  // Test with wingWindow(78, size, "intermediate", null)
  for (const size of [4, 5]) {
    const win = wingWindow(78, size, 'intermediate', null);
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
  const win = wingWindow(78, 5, 'intermediate', null);
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
  const skill = 'intermediate';
  const ww = wingWindow(78, 2, skill, null);
  const cw = calcWindow(78, 2, skill, null);
  assert.deepEqual(ww, cw, 'Wing 2m²: wingWindow muss identisch zu calcWindow sein (Bypass)');
});

test('Fall 5 — wingWindow(78, 7, ...) === calcWindow(78, 7, ...) (Blend-Bypass)', () => {
  const skill = 'intermediate';
  const ww = wingWindow(78, 7, skill, null);
  const cw = calcWindow(78, 7, skill, null);
  assert.deepEqual(ww, cw, 'Wing 7m²: wingWindow muss identisch zu calcWindow sein (Bypass)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 6 — Regression Foil/Kalibrierung
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 6a — wingWindow mit knownPlaneMs=6.0 deep-equal calcWindow (Bypass)', () => {
  const skill = 'intermediate', planeMs = 6.0;
  const ww = wingWindow(80, 5, skill, planeMs);
  const cw = calcWindow(80, 5, skill, planeMs);
  assert.deepEqual(ww, cw, 'kalibrierte Planing-Schwelle: wingWindow muss == calcWindow sein');
});

test('Fall 6b — Foil-Unabhängigkeit: calcWindow(80,5,"intermediate",null) identisch zu altem foil=1800-Ergebnis', () => {
  // REF_FOIL_TERM=0.8 entspricht foilF*0.8 bei 1800 cm² → Ergebnis numerisch gleich
  const cw = calcWindow(80, 5, 'intermediate', null);
  // Bekannter v3.13.0-Wert bei foil=1800: load=80/5=16, foilF=1, minW=max(2.5,(3.5+16*0.15+0.8)*1.25*0.85)
  const load = 80 / 5;
  const sMin = 1.25; // intermediate
  const minW_raw = Math.max(2.5, (3.5 + load * 0.15 + 0.8) * sMin * 0.85);
  const expectedMinWind = Math.round(minW_raw * 10) / 10;
  assert.equal(cw.minWind, expectedMinWind,
    `calcWindow ohne foil-Arg muss identisch zu altem foil=1800-Ergebnis sein (${expectedMinWind} m/s)`);
});

test('Fall 6b-2 — Skill wirkt weiter: beginner.maxWind < pro.maxWind', () => {
  const maxBeginner = calcWindow(80, 5, 'beginner', null).maxWind;
  const maxPro      = calcWindow(80, 5, 'pro', null).maxWind;
  assert(maxBeginner < maxPro,
    `beginner maxWind (${maxBeginner}) muss < pro maxWind (${maxPro}) sein`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fall 7 — E2E-Sweep Gialova: Plausibilitäts-Szenarien
// ─────────────────────────────────────────────────────────────────────────────
test('Fall 7 — E2E-Sweep Gialova: schwach < ideal, stark < ideal, ideal nahe 100', () => {
  const win = wingWindow(80, 5, 'intermediate', null);

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
  const win = wingWindow(80, 5, 'intermediate', null);
  const makeWinds = (speedMs) => Array.from({ length: 24 }, () => speedMs);

  for (const kn of [5, 8, 12, 16, 18, 22, 26, 30, 35, 40]) {
    const w = knToMs(kn);
    const s = scoreDay(makeWinds(w), win, 0);
    assert(!Number.isNaN(s), `scoreDay @ ${kn}kn darf nicht NaN sein`);
    assert(s >= 0 && s <= 100, `scoreDay @ ${kn}kn muss in [0,100] sein, got ${s}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fälle 6a-1..6 — Wing-Range-Feedback-Blend (v3.11.0)
// ─────────────────────────────────────────────────────────────────────────────

// 6a-1: Kein Feedback (spotWingRange=null) → deep-equal zu v3.10.0 (Regression)
test('Fall 6a-1 — spotWingRange=null → wingWindow identisch zu phys/tab-Blend', () => {
  // wingWindow mit und ohne null spotWingRange muss identisch sein
  const wNull  = wingWindow(93, 4, 'intermediate', null, 'Harlem Pace', null);
  const wUndef = wingWindow(93, 4, 'intermediate', null);
  assert.deepEqual(wNull, wUndef, 'null und weggelassener spotWingRange müssen identisch sein');
  // Ergebnis muss base (phys/tab-blend) entsprechen — TABLE_BLEND=0.5 (const, nicht per vm extrahierbar)
  const phys = calcWindow(93, 4, 'intermediate', null);
  const tab  = wingTableWindow(93, 4);
  const base = blendWindows(phys, tab, 0.5); // TABLE_BLEND=0.5
  assert.deepEqual(wNull, base, 'Ohne Feedback: wingWindow muss phys/tab-Blend sein');
});

// 6a-2: Feedback-Blend 4m²/Talamone — numerisch prüfen
test('Fall 6a-2 — Feedback-Blend 4m²: minWind höher als ohne Feedback, Richtung 25kn', () => {
  const spotWingRange = { minKn: 25, maxKn: 30, samples: 1 };
  const withFb    = wingWindow(93, 4, 'intermediate', null, 'Harlem Pace', spotWingRange);
  const withoutFb = wingWindow(93, 4, 'intermediate', null);

  // minWind muss höher sein (Feedback zieht Richtung 25kn = knToMs(25) ≈ 12.86 m/s)
  assert(withFb.minWind > withoutFb.minWind,
    `minWind mit Feedback (${withFb.minWind}) muss > ohne Feedback (${withoutFb.minWind})`);

  // Numerische Verifikation: blendWindows(base, rangeToWindow(25,30), 0.5)
  // TABLE_BLEND und FEEDBACK_BLEND sind const in vm, daher als Literal 0.5
  const phys = calcWindow(93, 4, 'intermediate', null);
  const tab  = wingTableWindow(93, 4);
  const base = blendWindows(phys, tab, 0.5); // TABLE_BLEND=0.5
  const fb   = rangeToWindow(25, 30);
  const expected = blendWindows(base, fb, 0.5); // FEEDBACK_BLEND=0.5
  assert.deepEqual(withFb, expected, 'Feedback-Blend muss exakt blendWindows(base,fb,0.5) entsprechen');

  // Plausibilität: Ergebnis liegt zwischen base und fb
  assert(withFb.minWind >= Math.min(base.minWind, fb.minWind) - 0.1,
    `minWind muss zwischen base (${base.minWind}) und fb (${fb.minWind}) liegen`);
});

// 6a-3: Samples-Gate: samples=0 → kein Blend; samples=1 → Blend aktiv
test('Fall 6a-3 — Samples-Gate: samples=0 kein Blend, samples=1 Blend aktiv', () => {
  const swr0 = { minKn: 20, maxKn: 28, samples: 0 };
  const swr1 = { minKn: 20, maxKn: 28, samples: 1 };
  const base = wingWindow(80, 4, 'intermediate', null);
  const with0 = wingWindow(80, 4, 'intermediate', null, 'Harlem Pace', swr0);
  const with1 = wingWindow(80, 4, 'intermediate', null, 'Harlem Pace', swr1);

  assert.deepEqual(with0, base, 'samples=0: kein Feedback-Blend (== base)');
  assert.notDeepEqual(with1, base, 'samples=1: Blend muss aktiv sein (≠ base)');
});

// 6a-4: Nur eine Grenze vorhanden (maxKn=null) → kein Range-Blend (Guard greift)
test('Fall 6a-4 — Nur maxKn=null: kein Feedback-Blend', () => {
  const swrNoMax  = { minKn: 20, maxKn: null,  samples: 3 };
  const swrNoMin  = { minKn: null, maxKn: 28,  samples: 3 };
  const base = wingWindow(80, 4, 'intermediate', null);
  const withNoMax = wingWindow(80, 4, 'intermediate', null, 'Harlem Pace', swrNoMax);
  const withNoMin = wingWindow(80, 4, 'intermediate', null, 'Harlem Pace', swrNoMin);

  assert.deepEqual(withNoMax, base, 'maxKn=null: kein Feedback-Blend');
  assert.deepEqual(withNoMin, base, 'minKn=null: kein Feedback-Blend');
});

// 6a-5: Bypass-Vorrang: knownPlaneMs>0 → Feedback-Layer ignoriert (deep-equal calcWindow)
test('Fall 6a-5 — Bypass: knownPlaneMs>0 → Feedback ignoriert', () => {
  const spotWingRange = { minKn: 25, maxKn: 30, samples: 5 };
  const planeMs = knToMs(18);
  const withBypass  = wingWindow(80, 4, 'intermediate', planeMs, 'Harlem Pace', spotWingRange);
  const physExpected = calcWindow(80, 4, 'intermediate', planeMs);

  assert.deepEqual(withBypass, physExpected,
    'knownPlaneMs>0: Bypass muss greifen; Feedback-Layer muss ignoriert werden');
});

// 6a-6: rangeToWindow/blendWindows Einheiten (kn→m/s), opt-Band 25/75
test('Fall 6a-6 — rangeToWindow: kn→m/s korrekt, opt-Band 25/75', () => {
  const minKn = 20, maxKn = 30;
  const w = rangeToWindow(minKn, maxKn);

  const loMs = knToMs(minKn);
  const hiMs = knToMs(maxKn);
  approx(w.minWind, Math.round(loMs*10)/10, 0.01, 'rangeToWindow minWind');
  approx(w.maxWind, Math.round(hiMs*10)/10, 0.01, 'rangeToWindow maxWind');
  approx(w.optMin,  Math.round((loMs + 0.25*(hiMs-loMs))*10)/10, 0.01, 'rangeToWindow optMin 25%');
  approx(w.optMax,  Math.round((loMs + 0.75*(hiMs-loMs))*10)/10, 0.01, 'rangeToWindow optMax 75%');

  // blendWindows kantenweise: 50/50 zweier identischer Fenster = selbiges Fenster
  const same = blendWindows(w, w, 0.5);
  assert.deepEqual(same, w, 'blendWindows(a, a, 0.5) muss a zurückgeben');
});

// ─────────────────────────────────────────────────────────────────────────────
// Live-Station-Nowcast-Boost (v3.15.0) — Fälle 1–9
// ─────────────────────────────────────────────────────────────────────────────

// ── Setup: extract live-boost block from index.html ──────────────────────────
const lbStartMarker = '// <<live-boost>>';
const lbEndMarker   = '// <</live-boost>>';
const lbStartIdx = html.indexOf(lbStartMarker);
const lbEndIdx   = html.indexOf(lbEndMarker);
assert(lbStartIdx !== -1, 'Sentinel <<live-boost>> nicht gefunden in index.html');
assert(lbEndIdx   !== -1, 'Sentinel <</live-boost>> nicht gefunden in index.html');
assert(lbStartIdx < lbEndIdx, 'live-boost Sentinels in falscher Reihenfolge');

const lbBlock = html.slice(lbStartIdx + lbStartMarker.length, lbEndIdx);

// Reuse the same sandbox (knToMs/msToKn/Math already present; add Date)
const lbCtx = vm.createContext({ knToMs, msToKn, Math, Date, console });
vm.runInContext(lbBlock, lbCtx);

const { applyLiveStationBoost } = lbCtx;

// Helper: build a 24h flat wind array (m/s)
const makeWins24 = (speedMs) => Array.from({ length: 24 }, () => speedMs);
const makeGust24 = (speedMs) => Array.from({ length: 24 }, () => speedMs * 1.3);

// Fall 1 — Kein/ungültiger Live: null, ok:false, sensorOk:false, wind:null → applied:false, Arrays identisch
test('Live-Boost Fall 1a — live=null → applied:false, wins identisch', () => {
  const wins = makeWins24(knToMs(8));
  const gust = makeGust24(knToMs(8));
  const r = applyLiveStationBoost(wins, gust, null, true);
  assert.equal(r.applied, false, 'applied muss false sein');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
  assert.equal(r.gust, gust, 'gust-Referenz muss identisch sein');
});

test('Live-Boost Fall 1b — live.ok=false → applied:false', () => {
  const wins = makeWins24(knToMs(8));
  const gust = makeGust24(knToMs(8));
  const live = { ok: false, wind: knToMs(15), time: '14:00', sensorOk: true };
  const r = applyLiveStationBoost(wins, gust, live, true);
  assert.equal(r.applied, false, 'applied muss false sein bei ok:false');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
});

test('Live-Boost Fall 1c — live.sensorOk=false → applied:false', () => {
  const wins = makeWins24(knToMs(8));
  const gust = makeGust24(knToMs(8));
  const live = { ok: true, wind: knToMs(15), time: '14:00', sensorOk: false };
  const r = applyLiveStationBoost(wins, gust, live, true);
  assert.equal(r.applied, false, 'applied muss false sein bei sensorOk:false');
});

test('Live-Boost Fall 1d — live.wind=null → applied:false', () => {
  const wins = makeWins24(knToMs(8));
  const gust = makeGust24(knToMs(8));
  const live = { ok: true, wind: null, time: '14:00', sensorOk: true };
  const r = applyLiveStationBoost(wins, gust, live, true);
  assert.equal(r.applied, false, 'applied muss false sein bei wind:null');
});

// Fall 2 — Nicht heute (isToday=false) → unverändert
test('Live-Boost Fall 2 — isToday=false → applied:false, Referenzgleichheit', () => {
  const wins = makeWins24(knToMs(8));
  const gust = makeGust24(knToMs(8));
  const live = { ok: true, wind: knToMs(18), time: '14:00', sensorOk: true };
  const r = applyLiveStationBoost(wins, gust, live, false);
  assert.equal(r.applied, false, 'applied muss false sein wenn isToday=false');
  assert.equal(r.wins, wins, 'wins muss identisch (Referenz) sein');
  assert.equal(r.gust, gust, 'gust muss identisch (Referenz) sein');
});

// Fall 3 — Station-Ratio < 1.2: Fenster-Boost aus, aber Nowcast-Anker greift (v3.15.0)
// effLive = live.wind (kein Gust) > bw[nowH]=modelW → Stunden 14+15 verankert, k===1
test('Live-Boost Fall 3 — Live/Modell < 1.2 → Fenster-Boost aus, Anker greift, k===1', () => {
  const modelW = knToMs(10);
  const wins = makeWins24(modelW);
  // Station 10% über Modell → k=1.1 < 1.2
  const liveWind = modelW * 1.1;
  const live = { ok: true, wind: liveWind, time: '14:00', sensorOk: true };
  const r = applyLiveStationBoost(wins, null, live, true);

  // Anker greift: effLive = liveWind (kein gust) > modelW → nowH=14 + 15 angehoben
  // effLive = liveWind + 0.5 * max(0, liveWind - liveWind) = liveWind
  const effLive = liveWind;
  assert.equal(r.applied, true, 'Anker greift trotz k<1.2 (applied:true)');
  assert.equal(r.k, 1, 'k muss 1 sein wenn Fenster-Boost nicht greift');
  const expectedAnchor = Math.round(effLive * 100) / 100;
  assert(Math.abs(r.wins[14] - expectedAnchor) < 0.001,
    `wins[14] soll auf effLive=${expectedAnchor} verankert sein, got ${r.wins[14]}`);
  assert(Math.abs(r.wins[15] - expectedAnchor) < 0.001,
    `wins[15] (nowH+1) soll auf effLive=${expectedAnchor} verankert sein, got ${r.wins[15]}`);
  // Fenster-Boost: Stunden außerhalb Anker (z.B. 11) sollen NICHT geliftet sein
  assert(Math.abs(r.wins[11] - modelW) < 0.001,
    `wins[11] (außerhalb Anker, kein Fenster-Boost) soll unverändert sein, got ${r.wins[11]}`);
});

// Fall 4 — Talamone-Fall: wins[15]=knToMs(7.6), live.wind=knToMs(15), time:"15:56"
// v3.15.0: nowH=15, Anker auf 15+16, Fenster-Boost für 11-14 und 17-19
test('Live-Boost Fall 4 — Talamone: k≈1.97, Fenster 11–19 angehoben, außen unverändert', () => {
  const modelW = knToMs(7.6);
  const wins = makeWins24(modelW);
  const gust = makeGust24(modelW);
  const live = { ok: true, wind: knToMs(15), time: '15:56', sensorOk: true, label: 'Talamone' };
  const r = applyLiveStationBoost(wins, gust, live, true);

  assert.equal(r.applied, true, 'Talamone-Fall: applied muss true sein');
  // k = live.wind / modelNow = knToMs(15)/knToMs(7.6) ≈ 1.9737, geclampt
  assert(r.k >= 1.97 && r.k <= 2.0, `k (${r.k}) muss zwischen 1.97 und 2.0 liegen`);

  // nowH=15: no gust, gustMs=live.wind=knToMs(15), effLive=live.wind=knToMs(15)
  // Anker-Stunden 15+16: bw[h] = round(effLive*100)/100 ≈ round(knToMs(15)*100)/100
  const effLive = knToMs(15); // live.wind + 0.5*max(0, live.wind-live.wind)
  const anchoredW = Math.round(effLive * 100) / 100;
  assert(Math.abs(r.wins[15] - anchoredW) < 0.001,
    `wins[15] (Anker) soll ${anchoredW} sein, got ${r.wins[15]}`);
  assert(Math.abs(r.wins[16] - anchoredW) < 0.001,
    `wins[16] (Anker+1) soll ${anchoredW} sein, got ${r.wins[16]}`);

  // Fenster-Boost-Stunden (11-14, 17-19): > 1.9× Modell
  const k_raw = knToMs(15) / modelW; // ≈ 1.9737
  for (let h = 11; h <= 19; h++) {
    assert(r.wins[h] > modelW * 1.9,
      `wins[${h}] (${r.wins[h]}) soll angehoben sein (> 1.9× Modell)`);
    // kein Wert darf über 2.01× Modellwind liegen (Anker unbedeckelt, aber ratio<2.01)
    assert(r.wins[h] <= modelW * 2.01 + 0.01,
      `wins[${h}] (${r.wins[h]}) soll nicht weit über Modellwind liegen`);
  }

  // Stunden außerhalb (9 und 20) unverändert
  assert(Math.abs(r.wins[9] - modelW) < 0.001,
    `wins[9] darf nicht verändert sein, got ${r.wins[9]}`);
  assert(Math.abs(r.wins[20] - modelW) < 0.001,
    `wins[20] darf nicht verändert sein (außerhalb Fenster), got ${r.wins[20]}`);

  assert.equal(r.station, 'Talamone', 'station muss "Talamone" sein');
  // nowKn: msToKn(effLive) gerundet auf eine Dezimalstelle
  const expectedNowKn = Math.round(msToKn(effLive) * 10) / 10;
  assert(Math.abs(r.nowKn - expectedNowKn) < 0.05,
    `nowKn (${r.nowKn}) soll ≈${expectedNowKn} sein`);
});

// Fall 5 — Clamp: Live/Modell=3.0 → k===2.0 für Fenster-Boost; Anker unkapped
// v3.15.0: Anker-Stunden (nowH=14,15) bekommen effLive (=3×modell, da kein gust), nicht geclampt
test('Live-Boost Fall 5 — Clamp: Fenster-Boost auf k=2.0 geclampt, Anker unkapped', () => {
  const modelW = knToMs(5);
  const wins = makeWins24(modelW);
  // Station 3× Modell, kein Gust → effLive = 3×modelW
  const live = { ok: true, wind: modelW * 3.0, time: '14:00', sensorOk: true };
  const r = applyLiveStationBoost(wins, null, live, true);
  assert.equal(r.applied, true, 'Clamp-Fall: muss trotzdem boosten');
  assert.equal(r.k, 2.0, `k muss auf 2.0 geclampt sein (Fenster-Boost), got ${r.k}`);

  // Anker-Stunden 14+15: effLive = 3×modelW (nicht geclampt)
  const effLive = modelW * 3.0; // gustMs=live.wind=3×modelW, Blend 0.5*(3-3)=0
  const expectedAnchor = Math.round(effLive * 100) / 100;
  assert(Math.abs(r.wins[14] - expectedAnchor) < 0.001,
    `wins[14] (Anker) soll effLive=${expectedAnchor} (=3×modell, unkapped), got ${r.wins[14]}`);

  // Fenster-Boost-Stunden außerhalb Anker (z.B. 11): k=2.0 geclampt
  const expectedBoosted = Math.round(modelW * 2.0 * 100) / 100;
  assert(Math.abs(r.wins[11] - expectedBoosted) < 0.001,
    `wins[11] (Fenster-Boost) soll 2.0×modell=${expectedBoosted}, got ${r.wins[11]}`);
});

// Fall 6 — Div-Guard: modelNow < 3kn → kein Boost (kein Infinity/NaN)
test('Live-Boost Fall 6 — Div-Guard: Modellwind < 3kn → applied:false, kein NaN', () => {
  const modelW = knToMs(1.5);  // << 3 kn Schwelle
  const wins = makeWins24(modelW);
  const live = { ok: true, wind: knToMs(10), time: '14:00', sensorOk: true };
  const r = applyLiveStationBoost(wins, null, live, true);
  assert.equal(r.applied, false, 'Modell < 3kn: kein Boost');
  assert(!Number.isNaN(r.k), 'k darf nicht NaN sein');
  for (const w of r.wins) assert(!Number.isNaN(w), 'wins darf kein NaN enthalten');
});

// Fall 7 — Aktivzeit-Gate: time:"22:30" (nowH=22 > 20) → unverändert
test('Live-Boost Fall 7 — Aktivzeit-Gate: time:22:30 (nowH>20) → applied:false', () => {
  const modelW = knToMs(8);
  const wins = makeWins24(modelW);
  const live = { ok: true, wind: knToMs(20), time: '22:30', sensorOk: true };
  const r = applyLiveStationBoost(wins, null, live, true);
  assert.equal(r.applied, false, 'nowH=22 außerhalb Aktivzeit → kein Boost');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
});

// Fall 8 — Gust-Verhalten: v3.15.0 Anker-Stunden bekommen gustMs direkt; außerhalb Anker k-skaliert
test('Live-Boost Fall 8a — Gust: Anker-Stunde bekommt gustMs direkt, Fenster-Stunden k-skaliert', () => {
  const modelW = knToMs(7.6);
  const wins = makeWins24(modelW);
  const gust = makeGust24(modelW);  // gust[h] = modelW * 1.3
  const live = { ok: true, wind: knToMs(15), time: '14:00', sensorOk: true };
  // nowH=14, kein gustMax/gust → gustMs = live.wind = knToMs(15)
  // effLive = live.wind + 0.5*max(0, gustMs - live.wind) = live.wind (da gleich)
  const gustMs = knToMs(15);
  const r = applyLiveStationBoost(wins, gust, live, true);
  assert.equal(r.applied, true, 'Gust-Test: muss boosten');

  // Anker-Stunden 14+15: gustMs > gust[14]? knToMs(15) ≈ 7.72 vs modelW*1.3 ≈ 5.08 → ja
  const expectedAnchorGust = Math.round(gustMs * 100) / 100;
  assert(Math.abs(r.gust[14] - expectedAnchorGust) < 0.001,
    `gust[14] (Anker) soll gustMs=${expectedAnchorGust}, got ${r.gust[14]}`);

  // Fenster-Boost-Stunden außerhalb Anker (z.B. 11): bg[11] = round(gust[11] * k * 100)/100
  const k = Math.min(live.wind / modelW, 2.0);
  const expectedBoostGust = Math.round(gust[11] * k * 100) / 100;
  assert(Math.abs(r.gust[11] - expectedBoostGust) < 0.001,
    `gust[11] (Fenster-Boost) soll ${expectedBoostGust}, got ${r.gust[11]}`);

  // Außerhalb des Fensters unverändert
  assert(Math.abs(r.gust[9] - gust[9]) < 0.001,
    `gust[9] soll unverändert sein, got ${r.gust[9]}`);
});

test('Live-Boost Fall 8b — gust=null bricht nicht', () => {
  const wins = makeWins24(knToMs(7.6));
  const live = { ok: true, wind: knToMs(15), time: '14:00', sensorOk: true };
  let r;
  assert.doesNotThrow(() => {
    r = applyLiveStationBoost(wins, null, live, true);
  }, 'gust=null darf keinen Fehler werfen');
  assert.equal(r.applied, true, 'muss auch ohne gust boosten');
  assert.equal(r.gust, null, 'gust soll null bleiben wenn Eingabe null');
});

// Fall 9 — Score-Wirkung: scoreDay(boosted) > scoreDay(roh) für Talamone-Fall
test('Live-Boost Fall 9 — Score-Wirkung: Boost-Score > Roh-Score (Talamone-Fall)', () => {
  // Talamone: Modell 7.6kn, Station 15kn — Rider 93kg, 5m², intermediate
  const modelW = knToMs(7.6);
  const wins = makeWins24(modelW);
  const gust = makeGust24(modelW);
  const live = { ok: true, wind: knToMs(15), time: '15:56', sensorOk: true };
  const lb = applyLiveStationBoost(wins, gust, live, true);
  assert.equal(lb.applied, true, 'Boost muss für diesen Fall aktiv sein');

  const win = ctx.wingWindow(93, 5, 'intermediate', null);
  const scoreRoh    = ctx.scoreDay(wins, win, 0);
  const scoreBoosted = ctx.scoreDay(lb.wins, win, 0);

  assert(!Number.isNaN(scoreRoh),    `scoreDay(roh) darf nicht NaN sein, got ${scoreRoh}`);
  assert(!Number.isNaN(scoreBoosted), `scoreDay(boosted) darf nicht NaN sein, got ${scoreBoosted}`);
  assert(scoreBoosted > scoreRoh,
    `Boost-Score (${scoreBoosted}) muss > Roh-Score (${scoreRoh}) sein`);
});

// ── Neue Fälle v3.15.0: Nowcast-Anker + Böen-Fahrbarkeit (TESTPLAN §Fälle 1–8) ──

// Testplan Fall 1 — Nowcast-Anker: Talamone 10.4/17.4 kn, Modell[13]=8kn
test('Live-Boost v3.15 Fall 1 — Nowcast-Anker: wins[13]+wins[14]=effLive, nowKn≈13.9', () => {
  const liveWind  = knToMs(10.4);
  const liveGustM = knToMs(17.4);
  // effLive = liveWind + 0.5 * (liveGustM - liveWind)
  const effLive = liveWind + 0.5 * Math.max(0, liveGustM - liveWind);
  const expectedNowKn = Math.round(msToKn(effLive) * 10) / 10;

  const modelNow = knToMs(8);
  const wins = makeWins24(modelNow);
  const live = { wind: liveWind, gustMax: liveGustM, time: '13:38', sensorOk: true, ok: true };
  const r = applyLiveStationBoost(wins, null, live, true);

  assert.equal(r.applied, true, 'applied muss true sein');
  // wins[13] und wins[14] = round(effLive*100)/100
  const expectedAnchor = Math.round(effLive * 100) / 100;
  assert(Math.abs(r.wins[13] - expectedAnchor) < 0.001,
    `wins[13] soll effLive=${expectedAnchor}, got ${r.wins[13]}`);
  assert(Math.abs(r.wins[14] - expectedAnchor) < 0.001,
    `wins[14] (nowH+1) soll effLive=${expectedAnchor}, got ${r.wins[14]}`);
  // nowKn ≈ 13.9
  assert(Math.abs(r.nowKn - expectedNowKn) < 0.05,
    `nowKn (${r.nowKn}) soll ≈${expectedNowKn} kn sein`);
  assert(r.nowKn >= 13.8 && r.nowKn <= 14.0,
    `nowKn (${r.nowKn}) soll ≈13.9 kn sein`);
});

// Testplan Fall 2 — Raise-only Anker: Modell an nowH bereits > effLive → unverändert
test('Live-Boost v3.15 Fall 2 — Raise-only Anker: Modell > effLive → nowH nicht gesenkt', () => {
  const liveWind  = knToMs(10.4);
  const liveGustM = knToMs(17.4);
  const effLive = liveWind + 0.5 * Math.max(0, liveGustM - liveWind);
  // Modell an nowH höher als effLive
  const modelNow = effLive + 1.0;  // etwas höher
  const wins = makeWins24(modelNow);
  const live = { wind: liveWind, gustMax: liveGustM, time: '14:00', sensorOk: true, ok: true };
  const r = applyLiveStationBoost(wins, null, live, true);

  // Raise-only: wins[14] soll unverändert bleiben (Modell > effLive)
  // Aber da k = liveWind/modelNow < 1.0 < 1.2, Fenster-Boost greift auch nicht
  // Anker-Prüfung: effLive <= bw[14] → kein Update
  assert(r.wins[14] >= modelNow - 0.001,
    `wins[14] (${r.wins[14]}) darf nicht unter Modell abgesenkt sein (raise-only)`);
});

// Testplan Fall 3 — Fenster-Boost getrennt: h=17 (außerhalb Anker nowH=13) mit k=live.wind/modelNow
test('Live-Boost v3.15 Fall 3 — Fenster-Boost: h=17 mit k (Grundwind, geclampt), nicht effLive', () => {
  const liveWind  = knToMs(10.4);
  const liveGustM = knToMs(17.4);
  const modelNow  = knToMs(8);
  const wins = makeWins24(modelNow);
  const live = { wind: liveWind, gustMax: liveGustM, time: '13:38', sensorOk: true, ok: true };
  const r = applyLiveStationBoost(wins, null, live, true);

  // k = liveWind / modelNow = knToMs(10.4)/knToMs(8), geclampt auf 2.0
  const k = Math.min(liveWind / modelNow, 2.0);
  // h=17 ist außerhalb Anker (nowH=13, nowH+1=14), innerhalb Fenster 11-19
  const expectedH17 = Math.round(modelNow * k * 100) / 100;
  assert(Math.abs(r.wins[17] - expectedH17) < 0.001,
    `wins[17] (Fenster-Boost) soll ${expectedH17} (k=${k.toFixed(4)}×modell), got ${r.wins[17]}`);
  // wins[17] != effLive (sie sind verschieden, weil effLive > liveWind)
  const effLive = liveWind + 0.5 * Math.max(0, liveGustM - liveWind);
  assert(Math.abs(r.wins[17] - Math.round(effLive * 100) / 100) > 0.1,
    `wins[17] soll NICHT effLive sein — Fenster-Boost ist grundwind-basiert`);
});

// Testplan Fall 4 — Böen-Array: gust[nowH]=gustMs; gust=null bricht nicht
test('Live-Boost v3.15 Fall 4 — Böen-Array: gust[13]=gustMs, gust=null sicher', () => {
  const liveWind  = knToMs(10.4);
  const liveGustM = knToMs(17.4);
  const modelNow  = knToMs(8);
  const wins = makeWins24(modelNow);
  const gust = makeGust24(modelNow);  // gust[h] = modelNow * 1.3
  const live = { wind: liveWind, gustMax: liveGustM, time: '13:38', sensorOk: true, ok: true };
  const r = applyLiveStationBoost(wins, gust, live, true);

  // gustMs = live.gustMax = knToMs(17.4)
  const gustMs = liveGustM;
  const expectedGust = Math.round(gustMs * 100) / 100;
  // gust[13] und gust[14] (Anker-Stunden): bg[h] = round(gustMs*100)/100 wenn gustMs > bg[h]
  assert(r.gust[13] >= expectedGust - 0.001,
    `gust[13] soll mindestens gustMs=${expectedGust}, got ${r.gust[13]}`);
  assert(r.gust[14] >= expectedGust - 0.001,
    `gust[14] (nowH+1) soll mindestens gustMs=${expectedGust}, got ${r.gust[14]}`);

  // gust=null darf nicht werfen
  assert.doesNotThrow(() => {
    applyLiveStationBoost(wins, null, live, true);
  }, 'gust=null darf keinen Fehler werfen');
});

// Testplan Fall 5 — k<Schwelle: Anker greift, Fenster-Boost nicht, k===1
test('Live-Boost v3.15 Fall 5 — k<1.2: Anker greift, Fenster-Boost aus, k===1', () => {
  const modelW   = knToMs(10);
  const liveWind = modelW * 1.1;  // k=1.1 < 1.2
  // effLive = liveWind (kein Gust)
  const wins = makeWins24(modelW);
  const live = { wind: liveWind, time: '14:00', sensorOk: true, ok: true };
  const r = applyLiveStationBoost(wins, null, live, true);

  // Anker: effLive = liveWind > modelW → applied:true
  assert.equal(r.applied, true, 'Anker greift (applied:true)');
  assert.equal(r.k, 1, 'k muss 1 sein (Fenster-Boost nicht aktiv)');
  // nowH=14,15 verankert
  const expectedAnchor = Math.round(liveWind * 100) / 100;
  assert(Math.abs(r.wins[14] - expectedAnchor) < 0.001,
    `wins[14] soll effLive=${expectedAnchor}, got ${r.wins[14]}`);
  // h=11 (außerhalb Anker): kein Fenster-Boost → unverändert
  assert(Math.abs(r.wins[11] - modelW) < 0.001,
    `wins[11] soll unverändert=${modelW.toFixed(4)}, got ${r.wins[11]}`);
});

// Testplan Fall 6 — Gate/Bypass: nicht heute / kein Live / sensorOk:false / nowH außerhalb 11–20
test('Live-Boost v3.15 Fall 6 — Gates: isToday=false/null/sensorOk=false/nowH<11 → unverändert', () => {
  const modelW = knToMs(10);
  const liveWind = knToMs(15);
  const wins = makeWins24(modelW);

  // isToday=false
  let r = applyLiveStationBoost(wins, null, { wind: liveWind, time: '14:00', sensorOk: true, ok: true }, false);
  assert.equal(r.applied, false, 'isToday=false → applied:false');
  assert.equal(r.wins, wins, 'wins-Referenz identisch');

  // live=null
  r = applyLiveStationBoost(wins, null, null, true);
  assert.equal(r.applied, false, 'live=null → applied:false');

  // sensorOk=false
  r = applyLiveStationBoost(wins, null, { wind: liveWind, time: '14:00', sensorOk: false, ok: true }, true);
  assert.equal(r.applied, false, 'sensorOk:false → applied:false');

  // nowH=9 < 11
  r = applyLiveStationBoost(wins, null, { wind: liveWind, time: '09:30', sensorOk: true, ok: true }, true);
  assert.equal(r.applied, false, 'nowH=9 < 11 → applied:false');
  assert.equal(r.wins, wins, 'wins-Referenz identisch (Gate)');
});

// Testplan Fall 7 — Score-Wirkung: Talamone-Fall (93 kg, 6.0 m²), scoreHour(effLive) > scoreHour(modelNow)
test('Live-Boost v3.15 Fall 7 — Score-Wirkung: effLive>modelNow ergibt höheren scoreHour', () => {
  const modelNow = knToMs(8);
  const liveWind = knToMs(10.4);
  const liveGustM = knToMs(17.4);
  const effLive = liveWind + 0.5 * Math.max(0, liveGustM - liveWind);

  const win = ctx.wingWindow(93, 6, 'intermediate', null);
  const scoreModel = ctx.scoreHour(modelNow, win);
  const scoreEff   = ctx.scoreHour(effLive, win);

  assert(!Number.isNaN(scoreModel), `scoreHour(modelNow) darf nicht NaN sein`);
  assert(!Number.isNaN(scoreEff),   `scoreHour(effLive) darf nicht NaN sein`);
  assert(scoreEff > scoreModel,
    `scoreHour(effLive=${msToKn(effLive).toFixed(1)}kn)=${scoreEff} muss > scoreHour(modelNow=${msToKn(modelNow).toFixed(1)}kn)=${scoreModel}`);

  // E2E: scoreDay mit lb.wins > scoreDay mit roh
  const wins = makeWins24(modelNow);
  const gust = makeGust24(modelNow);
  const live = { wind: liveWind, gustMax: liveGustM, time: '13:38', sensorOk: true, ok: true };
  const lb = applyLiveStationBoost(wins, gust, live, true);
  assert.equal(lb.applied, true, 'Boost muss aktiv sein');
  const scoreRoh    = ctx.scoreDay(wins, win, 0);
  const scoreBoosted = ctx.scoreDay(lb.wins, win, 0);
  assert(scoreBoosted > scoreRoh,
    `scoreBoosted (${scoreBoosted}) muss > scoreRoh (${scoreRoh})`);
});

// Testplan Fall 8 — Regression: measured-correction + wing-scoring unberührt
test('Live-Boost v3.15 Fall 8 — Regression: measured-correction und wing-scoring unberührt', () => {
  // Wing-scoring unberührt: einfacher Smoke-Test
  const win = ctx.wingWindow(78, 5, 'intermediate', null);
  const s = ctx.scoreDay(Array.from({length:24},()=>knToMs(18)), win, 0);
  assert(!Number.isNaN(s) && s >= 0 && s <= 100, `scoreDay unberührt: ${s}`);

  // measured-correction: applyLiveStationBoost berührt keine measured-Felder
  const wins = makeWins24(knToMs(10));
  const live = { wind: knToMs(15), time: '14:00', sensorOk: true, ok: true };
  const lb = applyLiveStationBoost(wins, null, live, true);
  assert(!('measuredCorr' in lb), 'liveBoost-Return darf kein measuredCorr-Feld enthalten');
});

// ─────────────────────────────────────────────────────────────────────────────
// Measured-Station-Korrektur (v3.13.0) — Fälle 1–8
// ─────────────────────────────────────────────────────────────────────────────

// ── Setup: extract measured-correction block from index.html ─────────────────
const mcStartMarker = '// <<measured-correction>>';
const mcEndMarker   = '// <</measured-correction>>';
const mcStartIdx = html.indexOf(mcStartMarker);
const mcEndIdx   = html.indexOf(mcEndMarker);
assert(mcStartIdx !== -1, 'Sentinel <<measured-correction>> nicht gefunden in index.html');
assert(mcEndIdx   !== -1, 'Sentinel <</measured-correction>> nicht gefunden in index.html');
assert(mcStartIdx < mcEndIdx, 'measured-correction Sentinels in falscher Reihenfolge');

const mcBlock = html.slice(mcStartIdx + mcStartMarker.length, mcEndIdx);

const mcCtx = vm.createContext({ Math, console });
vm.runInContext(mcBlock, mcCtx);

const { applyMeasuredStationCorrection, measuredWeight } = mcCtx;

// Helper: 24h flat wind array (m/s)
const makeMWins24 = (speedMs) => Array.from({ length: 24 }, () => speedMs);
const makeMGust24 = (speedMs) => Array.from({ length: 24 }, () => speedMs * 1.3);

const TODAY = '2026-08-02';

// Fall 1 — Kein/ungültig: null, ok:false, kein hourly → applied:false, Arrays identisch
test('Measured-Correction Fall 1a — measured=null → applied:false, Arrays identisch', () => {
  const wins = makeMWins24(knToMs(10));
  const gust = makeMGust24(knToMs(10));
  const r = applyMeasuredStationCorrection(wins, gust, null, TODAY);
  assert.equal(r.applied, false, 'applied muss false sein');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
  assert.equal(r.gust, gust, 'gust-Referenz muss identisch sein');
});

test('Measured-Correction Fall 1b — measured.ok=false → applied:false', () => {
  const wins = makeMWins24(knToMs(10));
  const gust = makeMGust24(knToMs(10));
  const measured = { ok: false, hourly: { wind: makeMWins24(knToMs(15)) }, date: TODAY, km: 0 };
  const r = applyMeasuredStationCorrection(wins, gust, measured, TODAY);
  assert.equal(r.applied, false, 'applied muss false sein bei ok:false');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
});

test('Measured-Correction Fall 1c — kein hourly → applied:false', () => {
  const wins = makeMWins24(knToMs(10));
  const measured = { ok: true, date: TODAY, km: 0 };
  const r = applyMeasuredStationCorrection(wins, null, measured, TODAY);
  assert.equal(r.applied, false, 'applied muss false sein ohne hourly');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
});

// Fall 2 — Datum-Mismatch → unverändert
test('Measured-Correction Fall 2 — Datum-Mismatch → applied:false, unverändert', () => {
  const wins = makeMWins24(knToMs(10));
  const gust = makeMGust24(knToMs(10));
  const measured = {
    ok: true, hourly: { wind: makeMWins24(knToMs(15)), gust: makeMGust24(knToMs(15)) },
    date: '2026-08-01', km: 0, label: 'Torbole'
  };
  const r = applyMeasuredStationCorrection(wins, gust, measured, TODAY);
  assert.equal(r.applied, false, 'Datum-Mismatch: applied muss false sein');
  assert.equal(r.wins, wins, 'wins-Referenz muss identisch sein');
  assert.equal(r.gust, gust, 'gust-Referenz muss identisch sein');
});

// Fall 3 — Nahe Station (km:0 → w=0.8): Anhebung wo mw>model; Stunden mit mw<=model unverändert; null-Messstunden unverändert
test('Measured-Correction Fall 3 — Nahe Station km:0: Anhebung korrekt, raise-only, null-Stunden unverändert', () => {
  // w = 0.8 * (1 - 0/50) = 0.8
  const w = 0.8;
  const modelLow  = knToMs(8);   // Station misst mehr → Anhebung
  const modelHigh = knToMs(15);  // Station misst weniger → unverändert
  const stationLow  = knToMs(12);
  const stationHigh = knToMs(10);

  const wins = Array.from({ length: 24 }, (_, h) => {
    if (h === 5) return null;        // null-Modellstunde
    if (h % 2 === 0) return modelLow;
    return modelHigh;
  });
  const mwind = Array.from({ length: 24 }, (_, h) => {
    if (h === 3) return null;        // null-Messstunde
    if (h % 2 === 0) return stationLow;
    return stationHigh;
  });
  const measured = { ok: true, hourly: { wind: mwind, gust: [] }, date: TODAY, km: 0, label: 'Torbole' };
  const r = applyMeasuredStationCorrection(wins, null, measured, TODAY);

  assert.equal(r.applied, true, 'applied muss true sein');

  // Stunden wo mw>model: gerade Stunden (außer 3=null-Messung, 5=null-Modell)
  for (let h = 0; h < 24; h++) {
    if (h === 5) {
      // null-Modellstunde: unverändert (null)
      assert.equal(r.wins[h], null, `wins[${h}] (null-Modell) muss null bleiben`);
    } else if (h === 3) {
      // null-Messstunde: mw[3]=null → keine Korrektur → bleibt modelHigh (h=3 ist ungerade → modelHigh)
      assert(Math.abs(r.wins[h] - modelHigh) < 0.001, `wins[${h}] (null-Messung) muss unverändert sein`);
    } else if (h % 2 === 0) {
      // stationLow > modelLow → Anhebung
      const expected = Math.round((modelLow + (stationLow - modelLow) * w) * 100) / 100;
      assert(Math.abs(r.wins[h] - expected) < 0.001,
        `wins[${h}] soll angehoben sein: erwartet ${expected}, got ${r.wins[h]}`);
    } else {
      // stationHigh < modelHigh → raise-only → unverändert
      assert(Math.abs(r.wins[h] - modelHigh) < 0.001,
        `wins[${h}] (Station < Modell) muss unverändert sein, got ${r.wins[h]}`);
    }
  }
});

// Fall 4 — Ferne Station (km:35): w=0.8*(1-35/50)=0.24; Anhebung schwächer
test('Measured-Correction Fall 4 — Ferne Station km:35: w=0.24, Anhebung schwächer', () => {
  const km = 35;
  const w = 0.8 * (1 - 35 / 50); // = 0.24
  const model = knToMs(10);
  const station = knToMs(14);     // Station mehr als Modell

  const wins = makeMWins24(model);
  const mwind = makeMWins24(station);
  const measured = { ok: true, hourly: { wind: mwind, gust: [] }, date: TODAY, km, label: 'LGPZ' };
  const r = applyMeasuredStationCorrection(wins, null, measured, TODAY);

  assert.equal(r.applied, true, 'applied muss true sein');
  const expected = Math.round((model + (station - model) * w) * 100) / 100;
  // Verify a sample hour
  assert(Math.abs(r.wins[12] - expected) < 0.001,
    `wins[12] ferne Station: erwartet ${expected} (w=${w}), got ${r.wins[12]}`);

  // Anhebung schwächer als nahe Station (km:0)
  const measuredNear = { ok: true, hourly: { wind: mwind, gust: [] }, date: TODAY, km: 0, label: 'Near' };
  const rNear = applyMeasuredStationCorrection(wins, null, measuredNear, TODAY);
  assert(rNear.wins[12] > r.wins[12],
    `Nahe Station (${rNear.wins[12]}) muss stärker anheben als ferne (${r.wins[12]})`);
});

// Fall 5 — Raise-only: überall mw<model → applied:false, unverändert
test('Measured-Correction Fall 5 — Raise-only: mw<model überall → applied:false', () => {
  const model = knToMs(15);
  const station = knToMs(10);  // Station misst WENIGER als Modell
  const wins = makeMWins24(model);
  const mwind = makeMWins24(station);
  const measured = { ok: true, hourly: { wind: mwind, gust: [] }, date: TODAY, km: 0, label: 'Torbole' };
  const r = applyMeasuredStationCorrection(wins, null, measured, TODAY);

  assert.equal(r.applied, false, 'Raise-only: applied muss false sein wenn Station überall niedrigerer misst');
  assert.equal(r.wins, wins, 'wins muss identisch (Referenz) sein');
});

// Fall 6 — Gust wird korrigiert; gust=null bricht nicht
test('Measured-Correction Fall 6a — Gust wird korrigiert', () => {
  const model   = knToMs(8);
  const station = knToMs(12);
  const wins = makeMWins24(model);
  const gust = makeMGust24(model);
  const km = 0;
  const w  = 0.8;
  const mwind = makeMWins24(station);
  const mgust = makeMGust24(station);
  const measured = { ok: true, hourly: { wind: mwind, gust: mgust }, date: TODAY, km, label: 'Torbole' };
  const r = applyMeasuredStationCorrection(wins, gust, measured, TODAY);

  assert.equal(r.applied, true, 'applied muss true sein');
  // gust-Korrektur: mg[h] > bg[h] → anheben
  const modelG  = gust[10];
  const stationG= mgust[10];
  if (stationG > modelG) {
    const expectedG = Math.round((modelG + (stationG - modelG) * w) * 100) / 100;
    assert(Math.abs(r.gust[10] - expectedG) < 0.001,
      `gust[10] soll korrigiert sein: erwartet ${expectedG}, got ${r.gust[10]}`);
  }
});

test('Measured-Correction Fall 6b — gust=null bricht nicht', () => {
  const wins = makeMWins24(knToMs(8));
  const mwind = makeMWins24(knToMs(12));
  const measured = { ok: true, hourly: { wind: mwind, gust: [] }, date: TODAY, km: 0, label: 'Torbole' };
  let r;
  assert.doesNotThrow(() => {
    r = applyMeasuredStationCorrection(wins, null, measured, TODAY);
  }, 'gust=null darf keinen Fehler werfen');
  assert.equal(r.applied, true, 'muss auch ohne gust korrigieren');
  assert.equal(r.gust, null, 'gust soll null bleiben wenn Eingabe null');
});

// Fall 7 — measuredWeight-Ränder: 0→0.8, 50→0, 60→0, null→0.8
test('Measured-Correction Fall 7 — measuredWeight Ränder', () => {
  const approxMW = (actual, expected, msg) =>
    assert(Math.abs(actual - expected) < 0.0001, `${msg}: erwartet ${expected}, got ${actual}`);

  approxMW(measuredWeight(0),    0.8, 'km=0 → 0.8');
  approxMW(measuredWeight(50),   0,   'km=50 → 0');
  approxMW(measuredWeight(60),   0,   'km=60 → 0 (geclampt)');
  approxMW(measuredWeight(null), 0.8, 'km=null → 0.8');

  // km=25 → 0.8*(1-25/50) = 0.4
  approxMW(measuredWeight(25), 0.4, 'km=25 → 0.4');
  // km=35 → 0.8*(1-35/50) = 0.24
  approxMW(measuredWeight(35), 0.24, 'km=35 → 0.24');
});

// Fall 8 — Score-Wirkung: Vasiliki-artig (km=35, model 12–16h niedrig, Station höher)
test('Measured-Correction Fall 8 — Score-Wirkung: korrigierter Score >= Roh-Score; non-mutating', () => {
  // Vasiliki-artig: Modell in Stunden 12–16 schwach, LGPZ Station etwas höher, km=35
  const modelW   = knToMs(10);  // Modell 10kn
  const stationW = knToMs(13);  // Station 13kn
  const km = 35;

  const wins = makeMWins24(modelW);
  const winsOriginal = wins.slice(); // Kopie zum Vergleich
  const mwind = makeMWins24(stationW);
  const measured = { ok: true, hourly: { wind: mwind, gust: [] }, date: TODAY, km, label: 'LGPZ' };

  const r = applyMeasuredStationCorrection(wins, null, measured, TODAY);

  // non-mutating: Original unverändert
  assert.deepEqual(wins, winsOriginal, 'Original-wins darf nicht verändert sein (non-mutating)');

  // Score-Wirkung: scoreDay(korr) >= scoreDay(roh)
  const win = ctx.wingWindow(93, 5, 'intermediate', null);
  const scoreRoh  = ctx.scoreDay(wins, win, 0);
  const scoreCorr = ctx.scoreDay(r.wins, win, 0);

  assert(!Number.isNaN(scoreRoh),  `scoreDay(roh) darf nicht NaN sein`);
  assert(!Number.isNaN(scoreCorr), `scoreDay(korr) darf nicht NaN sein`);
  assert(scoreCorr >= scoreRoh,
    `Korrigierter Score (${scoreCorr}) muss >= Roh-Score (${scoreRoh}) sein`);
});

// ─────────────────────────────────────────────────────────────────────────────
// v3.14.0 — Foil-Entfernung: Regressions-Assertions (§6 DESIGN-remove-foil.md)
// ─────────────────────────────────────────────────────────────────────────────

// §6-1: Foil-Unabhängigkeit — calcWindow ohne foil-Arg = alter foil=1800-Wert
test('v3.14 §6-1 — Foil-Unabhängigkeit: calcWindow(80,5,"intermediate",null) = Referenz-Foil-Wert', () => {
  const cw = calcWindow(80, 5, 'intermediate', null);
  // REF_FOIL_TERM=0.8 = foilF*0.8 bei 1800 cm² (foilF=1800/1800=1)
  // Erwarteter minW: max(2.5, (3.5 + (80/5)*0.15 + 0.8) * 1.25 * 0.85)
  const load = 80 / 5;
  const minW_raw = Math.max(2.5, (3.5 + load * 0.15 + 0.8) * 1.25 * 0.85);
  const expectedMinWind = Math.round(minW_raw * 10) / 10;
  assert.equal(cw.minWind, expectedMinWind,
    `calcWindow ohne foil muss numerisch identisch zu altem foil=1800 sein: erwartet ${expectedMinWind}, got ${cw.minWind}`);
  // Alle vier Felder müssen endliche Zahlen sein
  for (const key of ['minWind', 'optMin', 'optMax', 'maxWind']) {
    assert(Number.isFinite(cw[key]), `${key} muss endlich sein, got ${cw[key]}`);
  }
});

// §6-2: Skill wirkt weiter
test('v3.14 §6-2 — Skill wirkt weiter: calcWindow beginner.maxWind < pro.maxWind', () => {
  const maxBeginner = calcWindow(80, 5, 'beginner', null).maxWind;
  const maxPro      = calcWindow(80, 5, 'pro', null).maxWind;
  assert(maxBeginner < maxPro,
    `beginner maxWind (${maxBeginner}) muss < pro maxWind (${maxPro}) sein`);
});

// §6-3: Blend-Regression — wingWindow Feedback-Layer funktioniert wie zuvor (ein Arg weniger)
test('v3.14 §6-3 — Blend-Regression: wingWindow mit Feedback liefert blendWindows(base,fb,0.5)', () => {
  const spotWingRange = { minKn: 14, maxKn: 26, samples: 2 };
  const withFb    = wingWindow(80, 5, 'intermediate', null, 'Harlem Pace', spotWingRange);
  const withoutFb = wingWindow(80, 5, 'intermediate', null);

  // phys/tab-Blend als Basis
  const phys = calcWindow(80, 5, 'intermediate', null);
  const tab  = wingTableWindow(80, 5);
  const base = blendWindows(phys, tab, 0.5);
  const fb   = rangeToWindow(14, 26);
  const expected = blendWindows(base, fb, 0.5);

  assert.deepEqual(withFb, expected, 'Blend-Regression: wingWindow+Feedback muss blendWindows(base,fb,0.5) entsprechen');
  assert.notDeepEqual(withFb, withoutFb, 'Mit Feedback muss Ergebnis von ohne-Feedback abweichen');
});
