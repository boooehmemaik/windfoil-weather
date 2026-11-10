// ============================================================================
// WindFoil — Windalarm-Auswertung
// ----------------------------------------------------------------------------
// src/alerts.mjs ist rein, also wird hier die vollständige Entscheidungslogik
// geprüft: Schwelle, Entprellung, Zeitfilter, Offshore, Fahrerfenster.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import WF from './js/wf-scoring.js';
import {
  evaluateAlerts, formatAlert, splitDays, spotDayScores, weekday,
  DEFAULT_MIN_SCORE, LOOKAHEAD_DAYS,
} from './src/alerts.mjs';

// 10 m/s liegt mitten im Optimum des Referenzfahrers (6.6–17.2 m/s) → 100,
// 4 m/s darunter → deutlich unter jeder Schwelle.
const HIGH = 10, LOW = 4;
const DAY0 = '2026-11-10';

const pad = n => String(n).padStart(2, '0');

/** Stundenreihe über mehrere Tage; dayWinds[d] gilt für alle Stunden des Tages. */
function hourly(dayWinds, opts = {}) {
  const h = { time: [], windspeed_10m: [], winddirection_10m: [] };
  dayWinds.forEach((w, d) => {
    const date = new Date(Date.UTC(2026, 10, 10 + d)).toISOString().slice(0, 10);
    for (let hr = 0; hr < 24; hr++) {
      h.time.push(`${date}T${pad(hr)}:00`);
      h.windspeed_10m.push(typeof w === 'function' ? w(hr) : w);
      h.winddirection_10m.push(opts.dir ?? 180);
    }
  });
  if (opts.truncate) {
    for (const k of Object.keys(h)) h[k] = h[k].slice(0, h[k].length - opts.truncate);
  }
  return h;
}

const entry = (dayWinds, opts = {}) =>
  ({ hourly: hourly(dayWinds, opts), utcOffsetSeconds: opts.offset ?? 0 });

const SPOTS = {
  a: { name: 'Porto Pollo', emoji: '🏄', offshoreDir: null },
  b: { name: 'Stintino', emoji: '🌊', offshoreDir: null },
};

/** now vor jedem Sessionbeginn des ersten Tages. */
const BEFORE = new Date(`${DAY0}T00:00:00Z`);

function run(over) {
  return evaluateAlerts({
    spots: SPOTS, windows: {}, now: BEFORE,
    forecast: { spots: { a: entry([HIGH, LOW, LOW, LOW, LOW]) } },
    subscriptions: [{ userId: 'u1', spotId: 'a', minScore: 70 }],
    ...over,
  });
}

test('splitDays: nur vollständige Tage, die um 00:00 beginnen', () => {
  assert.deepStrictEqual(splitDays(hourly([1, 2, 3])).map(d => d.start), [0, 24, 48]);
  // Letzter Tag endet um 17:00 — eine Session bis 19 Uhr lässt sich daraus
  // nicht bewerten, ein Push dafür wäre erfunden.
  assert.deepStrictEqual(splitDays(hourly([1, 2], { truncate: 7 })).map(d => d.date), [DAY0]);
  // Reihe, die mittags beginnt: der erste Tag ist unvollständig.
  const mid = hourly([1, 2]);
  for (const k of Object.keys(mid)) mid[k] = mid[k].slice(12);
  assert.deepStrictEqual(splitDays(mid).map(d => d.date), ['2026-11-11']);
  assert.deepStrictEqual(splitDays(null), []);
});

test('spotDayScores: Score, Sessionfenster und Wind in Knoten', () => {
  const [day] = spotDayScores(entry([HIGH, LOW]), WF.guestWindow(), SPOTS.a, BEFORE);
  assert.strictEqual(day.date, DAY0);
  assert.strictEqual(day.score, 100);
  assert.strictEqual(day.startHour, WF.FIRST_START);
  assert.strictEqual(day.endHour, WF.FIRST_START + WF.SESSION_H);
  assert.strictEqual(day.windKn, Math.round(WF.msToKn(HIGH)));
});

test('evaluateAlerts: über der Schwelle wird gemeldet, darunter nicht', () => {
  const hit = run();
  assert.deepStrictEqual(hit.map(u => u.userId), ['u1']);
  assert.strictEqual(hit[0].hits.length, 1, 'nur der Starktag');
  assert.strictEqual(hit[0].hits[0].name, 'Porto Pollo');
  assert.strictEqual(hit[0].hits[0].score, 100);

  assert.deepStrictEqual(run({ forecast: { spots: { a: entry([LOW, LOW, LOW]) } } }), [],
    'schwacher Wind hat einen Alarm ausgelöst');
});

test('evaluateAlerts: die Schwelle gilt pro Abo', () => {
  // 7 m/s liegt zwischen minWind (6.6) und optMin (7.9) → Score 64.
  const fc = { spots: { a: entry([7, LOW, LOW]) } };
  const win = WF.guestWindow();
  assert.strictEqual(spotDayScores(fc.spots.a, win, SPOTS.a, BEFORE)[0].score, 64,
    'Testannahme über den Score stimmt nicht mehr');

  assert.deepStrictEqual(run({ forecast: fc }), [], '64 lag über der Schwelle 70');
  const low = run({ forecast: fc, subscriptions: [{ userId: 'u1', spotId: 'a', minScore: 50 }] });
  assert.strictEqual(low.length, 1, 'Schwelle 50 hätte greifen müssen');
});

test('evaluateAlerts: ohne minScore gilt der Standardwert', () => {
  const fc = { spots: { a: entry([7, LOW, LOW]) } };   // Score 64
  // Nicht gegen die Zahl 70 oder 40 geprüft, sondern gegen die Konstante: ihr
  // Wert darf sich ändern, ihre Wirkung nicht. Vorher stand hier das Literal —
  // beim Absenken auf 40 war dieser Test das einzige, was rot wurde, und das
  // sagte nichts über einen Fehler aus.
  assert.ok(DEFAULT_MIN_SCORE < 64, `Fixture-Score 64 muss über dem Standard ${DEFAULT_MIN_SCORE} liegen`);
  assert.strictEqual(run({ forecast: fc, subscriptions: [{ userId: 'u1', spotId: 'a' }] }).length, 1,
    'ohne minScore muss der Standardwert greifen');
  // Gegenprobe: eine ausdrücklich höhere Schwelle greift beim selben Forecast nicht.
  assert.deepStrictEqual(run({ forecast: fc, subscriptions: [{ userId: 'u1', spotId: 'a', minScore: 90 }] }), []);
});

test('evaluateAlerts: schon verschickte Tage werden entprellt', () => {
  const sent = new Set([`u1|a|${DAY0}`]);
  assert.deepStrictEqual(run({ sent }), [], 'derselbe Tag wurde erneut gemeldet');
  // Ein anderer Tag bleibt meldbar.
  assert.strictEqual(run({ sent, forecast: { spots: { a: entry([LOW, HIGH, LOW]) } } }).length, 1);
});

test('evaluateAlerts: eine bereits laufende Session löst keinen Push mehr aus', () => {
  // Alle Sessions des Tages starten 9–15 Uhr. Um 16 Uhr Ortszeit ist nichts
  // mehr zu holen — ein Push darüber wäre nur Frust.
  assert.deepStrictEqual(run({ now: new Date(`${DAY0}T16:00:00Z`) }), []);
  assert.strictEqual(run({ now: new Date(`${DAY0}T08:59:00Z`) }).length, 1);
});

test('evaluateAlerts: der Zeitfilter rechnet den Ortszeit-Offset ein', () => {
  // +2 h: 9 Uhr Ortszeit ist 07:00 UTC.
  const fc = { spots: { a: entry([HIGH, LOW, LOW], { offset: 7200 }) } };
  assert.strictEqual(run({ forecast: fc, now: new Date(`${DAY0}T06:30:00Z`) }).length, 1,
    'vor Sessionbeginn, hätte melden müssen');
  assert.deepStrictEqual(run({ forecast: fc, now: new Date(`${DAY0}T07:30:00Z`) }), [],
    'Session lief schon');
});

test('evaluateAlerts: Offshore-Wind erzeugt keinen Alarm', () => {
  const fc = { spots: { a: entry([HIGH, HIGH, HIGH], { dir: 90 }) } };
  const spots = { a: { ...SPOTS.a, offshoreDir: 90 } };
  assert.deepStrictEqual(run({ forecast: fc, spots }), [],
    'ablandiger Wind wurde als fahrbar gemeldet');
  assert.strictEqual(run({ forecast: fc, spots: SPOTS }).length, 1,
    'ohne offshoreDir hätte derselbe Wind melden müssen');
});

test('evaluateAlerts: jeder Nutzer wird mit seinem eigenen Fenster bewertet', () => {
  // 7 m/s: für den Referenzfahrer (6 m²) nur 64, mit 9 m² dagegen 83.
  const fc = { spots: { a: entry([7, LOW, LOW]) } };
  const out = evaluateAlerts({
    forecast: fc, spots: SPOTS, now: BEFORE,
    windows: { big: WF.windowFromRider({ weight: 75, wingSize: 9, skill: 'intermediate' }) },
    subscriptions: [
      { userId: 'guest', spotId: 'a', minScore: 70 },
      { userId: 'big', spotId: 'a', minScore: 70 },
    ],
  });
  assert.deepStrictEqual(out.map(u => u.userId), ['big'],
    'das Memo hat ein Fenster über Nutzergrenzen hinweg wiederverwendet');
});

test('evaluateAlerts: mehrere Spots landen in einem Nutzereintrag, bester zuerst', () => {
  const out = evaluateAlerts({
    now: BEFORE, spots: SPOTS,
    // 7.5 m/s → 76, HIGH → 100: der schwächere Spot muss hinten landen.
    forecast: { spots: { a: entry([7.5, LOW, LOW]), b: entry([HIGH, LOW, LOW]) } },
    subscriptions: [
      { userId: 'u1', spotId: 'a', minScore: 70 },
      { userId: 'u1', spotId: 'b', minScore: 70 },
    ],
  });
  assert.strictEqual(out.length, 1, 'ein Eintrag je Nutzer');
  assert.deepStrictEqual(out[0].hits.map(h => h.spotId), ['b', 'a']);
});

test('evaluateAlerts: der Lookahead endet nach fünf Tagen', () => {
  assert.strictEqual(LOOKAHEAD_DAYS, 5);
  const fc = { spots: { a: entry([LOW, LOW, LOW, LOW, LOW, HIGH, HIGH]) } };
  assert.deepStrictEqual(run({ forecast: fc }), [], 'Tag 6 wurde gemeldet');
  assert.strictEqual(run({ forecast: fc, lookaheadDays: 7 }).length, 1);
});

test('evaluateAlerts: fehlende oder leere Forecasts werden übersprungen', () => {
  assert.deepStrictEqual(run({ forecast: { spots: { a: null } } }), []);
  assert.deepStrictEqual(run({ forecast: { spots: {} } }), []);
  assert.deepStrictEqual(run({ forecast: { spots: { a: { hourly: { time: [] } } } } }), []);
  assert.deepStrictEqual(evaluateAlerts(), []);
});

test('weekday(): UTC-fest, unabhängig von der Serverzeitzone', () => {
  assert.strictEqual(weekday('2026-11-10'), 'Di');
  assert.strictEqual(weekday('2026-11-15'), 'So');
});

test('formatAlert: ein Treffer nennt den Spot, mehrere werden gebündelt', () => {
  const [{ hits }] = run();
  const one = formatAlert(hits);
  assert.match(one.title, /Porto Pollo: Score 100/);
  assert.match(one.body, /Porto Pollo Di 9–13 Uhr · Score 100 · 19 kn/);
  assert.strictEqual(one.url, '/vergleich.html#a');
  assert.strictEqual(one.tag, `wf-alert-${DAY0}`);

  const many = formatAlert([
    { ...hits[0] },
    { ...hits[0], spotId: 'b', name: 'Stintino', score: 80, date: '2026-11-11' },
    { ...hits[0], spotId: 'c', name: 'Putzu Idu', score: 75, date: '2026-11-12' },
    { ...hits[0], spotId: 'd', name: 'Avola', score: 71, date: '2026-11-13' },
  ]);
  assert.match(many.title, /4 Alarme — top Porto Pollo \(100\)/);
  // Höchstens drei Zeilen: die Benachrichtigung wird sonst abgeschnitten.
  assert.strictEqual(many.body.split('\n').length, 3);
  assert.ok(!many.body.includes('Avola'));
});
