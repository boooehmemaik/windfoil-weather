// Verhindert, dass das Scoring wieder zwischen den Seiten auseinanderläuft.
// Historie: die Spot-Seiten rechneten monatelang ein überholtes Modell und
// wichen bis zu 46 Punkte von index.html ab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import WF from './js/wf-scoring.js';

const ROOT = new URL('./', import.meta.url);
const read = f => readFileSync(new URL(f, ROOT), 'utf8');

const SCORING_PAGES = [
  'sardinia.html', 'sizilien.html', 'spanien.html',
  'skandinavien.html', 'vergleich.html',
];

test('kein Scoring-Nachbau: Seiten definieren calcWindow/scoreHour/scoreDay nicht selbst', () => {
  const forbidden = ['calcWindow', 'scoreHour', 'scoreDay', 'offshoreMultiplier', 'bestSession'];
  for (const page of SCORING_PAGES) {
    const src = read(page);
    for (const fn of forbidden) {
      assert.ok(
        !new RegExp(`function\\s+${fn}\\s*\\(`).test(src),
        `${page} definiert ${fn}() selbst — muss js/wf-scoring.js nutzen`
      );
    }
  }
});

test('alle Scoring-Seiten laden js/wf-scoring.js', () => {
  for (const page of SCORING_PAGES) {
    assert.match(read(page), /<script src="\/js\/wf-scoring\.js"><\/script>/,
      `${page} lädt das Scoring-Modul nicht`);
  }
});

test('index.html hält keine zweite calcWindow-Implementierung', () => {
  const src = read('index.html');
  assert.ok(!/function\s+calcWindow\s*\(/.test(src),
    'index.html definiert calcWindow() selbst — muss js/wf-scoring.js nutzen');
});

test('calcWindow: Fenster ist monoton geordnet', () => {
  for (const skill of ['beginner', 'intermediate', 'advanced', 'pro']) {
    for (const wing of [3, 4, 5, 6, 7]) {
      const w = WF.calcWindow(75, wing, skill);
      assert.ok(w.minWind <= w.optMin, `${skill}/${wing}: minWind > optMin`);
      assert.ok(w.optMin  <= w.optMax, `${skill}/${wing}: optMin > optMax`);
      assert.ok(w.optMax  <= w.maxWind, `${skill}/${wing}: optMax > maxWind`);
    }
  }
});

test('calcWindow: gemessene Planing-Schwelle schlägt das Modell', () => {
  assert.equal(WF.calcWindow(75, 6, 'intermediate', 5.5).minWind, 5.5);
  assert.notEqual(WF.calcWindow(75, 6, 'intermediate').minWind, 5.5);
});

test('calcWindow: Skill verschiebt das Fenster nach oben', () => {
  const b = WF.calcWindow(75, 6, 'beginner'), p = WF.calcWindow(75, 6, 'pro');
  assert.ok(b.minWind > p.minWind, 'Beginner braucht mehr Wind zum Angleiten');
  assert.ok(p.maxWind > b.maxWind, 'Pro verträgt mehr Wind');
});

test('scoreHour: 0 bei Flaute, 100 im Optimum, Abfall über maxWind', () => {
  const win = WF.calcWindow(75, 6, 'intermediate');
  assert.equal(WF.scoreHour(0, win), 0);
  assert.equal(WF.scoreHour((win.optMin + win.optMax) / 2, win), 100);
  assert.ok(WF.scoreHour(win.maxWind + 5, win) < WF.scoreHour(win.maxWind, win));
  assert.equal(WF.scoreHour(99, win), 0, 'Orkan muss 0 ergeben, nicht negativ');
});

test('offshoreMultiplier: ablandig sperrt, auflandig und Seitenwind nicht', () => {
  assert.equal(WF.offshoreMultiplier(90, 90), 0, 'exakt ablandig');
  assert.equal(WF.offshoreMultiplier(270, 90), 1, 'exakt auflandig');
  assert.equal(WF.offshoreMultiplier(180, 90), 1, 'Seitenwind');
  assert.equal(WF.offshoreMultiplier(120, 90), 0, '30° — noch im Sperrsektor');
  assert.equal(WF.offshoreMultiplier(140, 90), 1, '50° — außerhalb');
  assert.equal(WF.offshoreMultiplier(null, 90), 1, 'ohne Richtung keine Strafe');
  assert.equal(WF.offshoreMultiplier(90, null), 1, 'ohne offshoreDir keine Strafe');
  assert.equal(WF.offshoreMultiplier(5, 355), 0, 'Nordwrap korrekt');
});

test('meanDirection: Kreismittel, nicht arithmetisches Mittel', () => {
  const near = (got, exp, msg) => assert.ok(Math.abs(got - exp) < 0.01, `${msg}: ${got} ≠ ${exp}`);
  // Der Grund für die ganze Funktion: arithmetisch käme hier 180 heraus — Süd
  // statt Nord. Dieser Fall ist auf der Karte die glatte Gegenrichtung.
  near(WF.meanDirection([350, 10]), 0, 'Nordwrap');
  near(WF.meanDirection([355, 5, 0]), 0, 'Nordwrap mit drei Werten');
  near(WF.meanDirection([90, 90, 90]), 90, 'konstant Ost');
  near(WF.meanDirection([80, 100]), 90, 'ohne Wrap wie das arithmetische Mittel');
  near(WF.meanDirection([270, 350]), 310, 'Westnordwest');

  // Lücken dürfen das Mittel nicht verschieben, nur verkleinern.
  near(WF.meanDirection([null, 90, undefined, 90]), 90, 'Nullwerte übersprungen');
  near(WF.meanDirection([NaN, 180]), 180, 'NaN übersprungen');

  // null, nicht 0: 0 wäre Nord und damit eine erfundene Richtung.
  assert.equal(WF.meanDirection([]), null, 'leere Reihe');
  assert.equal(WF.meanDirection(null), null, 'keine Reihe');
  assert.equal(WF.meanDirection([null, NaN]), null, 'nur Lücken');

  // Ergebnis immer in [0,360) — atan2 liefert negative Winkel.
  for (const dirs of [[200, 250], [181, 359], [300, 20], [120, 300]]) {
    const r = WF.meanDirection(dirs);
    assert.ok(r >= 0 && r < 360, `${dirs} → ${r} außerhalb [0,360)`);
  }
});

test('bestBlock: findet den besten zusammenhängenden Reiseblock', () => {
  // Der Block muss zusammenhängen. Würde die Funktion einfach die besten n
  // Tage picken, käme hier 100/100 heraus — eine Reise über Tag 2 hinweg.
  assert.deepStrictEqual(WF.bestBlock([100, 0, 100, 0, 0], 2),
    { startIdx: 0, endIdx: 1, mean: 50, min: 0 });

  assert.deepStrictEqual(WF.bestBlock([10, 20, 90, 80, 30], 2),
    { startIdx: 2, endIdx: 3, mean: 85, min: 80 });
  // 90/80/30 (Ø 66,7) schlägt 20/90/80 (Ø 63,3) — ein starker Randtag kann
  // einen schwachen Schlusstag aufwiegen.
  assert.deepStrictEqual(WF.bestBlock([10, 20, 90, 80, 30], 3),
    { startIdx: 2, endIdx: 4, mean: 67, min: 30 });

  // len=1 ist der beste Einzeltag.
  assert.deepStrictEqual(WF.bestBlock([10, 95, 30], 1),
    { startIdx: 1, endIdx: 1, mean: 95, min: 95 });

  // Bei gleichem Mittel gewinnt der gleichmäßigere Block: 70/70 schlägt 100/40,
  // weil bei letzterem ein Reisetag ausfällt.
  assert.deepStrictEqual(WF.bestBlock([100, 40, 70, 70], 2),
    { startIdx: 2, endIdx: 3, mean: 70, min: 70 });

  // Gleichstand auch im Minimum → der frühere Block, damit die Empfehlung
  // zwischen zwei Seitenaufrufen nicht springt.
  assert.deepStrictEqual(WF.bestBlock([80, 80, 80, 80], 2),
    { startIdx: 0, endIdx: 1, mean: 80, min: 80 });
});

test('bestBlock: zu kurze oder löchrige Reihen liefern null statt 0', () => {
  // Ein Block von 0 wäre „Reise lohnt nicht"; fehlende Daten sind etwas anderes.
  assert.strictEqual(WF.bestBlock([50, 60], 3), null, 'Reihe kürzer als der Block');
  assert.strictEqual(WF.bestBlock([], 1), null);
  assert.strictEqual(WF.bestBlock(null, 1), null);
  assert.strictEqual(WF.bestBlock([null, undefined, NaN], 1), null, 'nur Lücken');

  // Lücken werden übersprungen, nicht als 0 gewertet — sonst zöge ein fehlender
  // Tag den Blockdurchschnitt nach unten und der Spot verschwände aus dem Ranking.
  assert.deepStrictEqual(WF.bestBlock([90, null, 90], 2),
    { startIdx: 0, endIdx: 1, mean: 90, min: 90 });

  // Unsinnige Blocklänge fällt auf einen Tag zurück, statt null zu liefern.
  for (const len of [0, -2, 1.5, null, undefined, 'x']) {
    assert.deepStrictEqual(WF.bestBlock([10, 95, 30], len),
      { startIdx: 1, endIdx: 1, mean: 95, min: 95 }, `len=${len}`);
  }
});

const day = h => { const d = []; for (let i = 0; i < 24; i++) d.push(h[i] ?? 0); return d; };

test('scoreDay: beste 4h-Session zählt, nicht der Tagesmittelwert', () => {
  const win = WF.calcWindow(75, 6, 'intermediate');
  // Flauer Vormittag, brauchbarer Nachmittag → Session muss sich durchsetzen.
  const thermik = day({ 9: 2, 10: 2, 11: 3, 12: 4, 13: 9, 14: 10, 15: 10, 16: 10, 17: 5, 18: 3 });
  const s = WF.bestSession(thermik, win);
  assert.equal(s.score, 100);
  assert.equal(s.startHour, 13);
  assert.equal(s.endHour, 17);
  assert.equal(WF.scoreDay(thermik, win), 100);
});

test('scoreDay: Offshore-Penalty nullt den Tag trotz perfektem Wind', () => {
  const win = WF.calcWindow(75, 6, 'intermediate');
  const winds = day({ 9: 10, 10: 10, 11: 10, 12: 10, 13: 10, 14: 10, 15: 10, 16: 10, 17: 10, 18: 10 });
  const dirs  = day({ 9: 90, 10: 90, 11: 90, 12: 90, 13: 90, 14: 90, 15: 90, 16: 90, 17: 90, 18: 90 });
  assert.equal(WF.scoreDay(winds, win, { dirs, offshoreDir: 90 }), 0, 'voll ablandig → 0');
  assert.equal(WF.scoreDay(winds, win, { dirs, offshoreDir: 270 }), 100, 'auflandig → unverändert');
});

test('scoreDay: start-Offset adressiert den richtigen Tag', () => {
  const win = WF.calcWindow(75, 6, 'intermediate');
  const flat = new Array(72).fill(0);
  for (let h = 9; h <= 18; h++) flat[24 + h] = 10;   // nur Tag 2 hat Wind
  assert.equal(WF.scoreDay(flat, win, { start: 0 }), 0);
  assert.equal(WF.scoreDay(flat, win, { start: 24 }), 100);
});

test('scoreDay: leerer Forecast ergibt 0, nicht NaN', () => {
  const win = WF.calcWindow(75, 6, 'intermediate');
  const s = WF.scoreDay([], win);
  assert.equal(s, 0);
  assert.ok(Number.isFinite(s));
});

test('hourlyScores: 10 Werte (9–18 Uhr), Penalty angewandt', () => {
  const win = WF.calcWindow(75, 6, 'intermediate');
  const winds = day({ 9: 10, 10: 10, 11: 10, 12: 10, 13: 10, 14: 10, 15: 10, 16: 10, 17: 10, 18: 10 });
  assert.equal(WF.hourlyScores(winds, win).length, 10);
  const dirs = day({ 9: 90, 10: 90, 11: 90, 12: 90, 13: 90, 14: 90, 15: 90, 16: 90, 17: 90, 18: 90 });
  assert.deepEqual(WF.hourlyScores(winds, win, { dirs, offshoreDir: 90 }), new Array(10).fill(0));
});

test('blendWindows: Randgewichte liefern die Originale', () => {
  const a = WF.calcWindow(75, 6, 'beginner'), b = WF.calcWindow(75, 6, 'pro');
  assert.deepEqual(WF.blendWindows(a, b, 0), a);
  assert.deepEqual(WF.blendWindows(a, b, 1), b);
});

test('jeder Spot mit offshoreDir hat einen plausiblen Kurs', () => {
  const pages = readdirSync(new URL('./', ROOT)).filter(f => SCORING_PAGES.includes(f));
  let found = 0;
  for (const page of pages) {
    for (const m of read(page).matchAll(/offshoreDir:\s*(-?\d+)/g)) {
      const deg = Number(m[1]);
      assert.ok(deg >= 0 && deg < 360, `${page}: offshoreDir ${deg} außerhalb 0–359`);
      found++;
    }
  }
  assert.ok(found > 0, 'keine offshoreDir-Angaben gefunden — Penalty wäre wirkungslos');
});
