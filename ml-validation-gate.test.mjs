/**
 * ml-validation-gate.test.mjs
 * Validierungs-Tier (assessValidation), Live-Drift (computeDrift) und
 * Backfill-Priorität (prioritizeStations). Kein Netz, keine DB-Dateien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessValidation, computeDrift, validationTier,
  VALIDATED_MIN_TEST, VALIDATED_MIN_DAYS, TAIL_MIN_MS, TAIL_MIN_N, TAIL_MIN_DAYS,
} from './src/neural_mos.mjs';
import { prioritizeStations, DEFAULT_PRIORITY_KEYS } from './src/ml_backfill.mjs';

function makeTest(n, { days = 30, fc = TAIL_MIN_MS + 1, y = 1 } = {}) {
  const t0 = Date.UTC(2026, 0, 1);
  return Array.from({ length: n }, (_, i) => ({
    x: [], y,
    row: { ts: new Date(t0 + Math.floor(i * days * 24 / n) * 3600e3).toISOString(), fc_wind_ms: fc },
  }));
}

test('assessValidation: genug Daten + Modell besser im Tail → validated', () => {
  const v = assessValidation(makeTest(VALIDATED_MIN_TEST), () => 0.9);
  assert.equal(v.tier, 'validated');
  assert.deepEqual(v.reasons, []);
});

test('assessValidation: zu wenig Samples → provisional few_samples', () => {
  const v = assessValidation(makeTest(VALIDATED_MIN_TEST - 1), () => 0.9);
  assert.equal(v.tier, 'provisional');
  assert.ok(v.reasons.includes('few_samples'));
});

test('assessValidation: zu wenig Tage → few_days', () => {
  const v = assessValidation(makeTest(VALIDATED_MIN_TEST, { days: VALIDATED_MIN_DAYS - 1 }), () => 0.9);
  assert.ok(v.reasons.includes('few_days'));
  assert.equal(v.testDays, VALIDATED_MIN_DAYS - 1);
});

test('assessValidation: kaum Starkwind im Test → tail_untested', () => {
  const v = assessValidation(makeTest(VALIDATED_MIN_TEST, { fc: TAIL_MIN_MS - 1 }), () => 0.9);
  assert.ok(v.reasons.includes('tail_untested'));
  assert.equal(v.tailN, 0);
  assert.equal(v.maeRawTail, null);
});

test('assessValidation: Tail genau an den Schwellen (Stunden und Tage) zählt als getestet', () => {
  const t = makeTest(VALIDATED_MIN_TEST, { fc: TAIL_MIN_MS - 1 });
  const step = Math.floor(t.length / TAIL_MIN_N);
  for (let i = 0; i < TAIL_MIN_N; i++) t[i * step].row.fc_wind_ms = TAIL_MIN_MS;
  const v = assessValidation(t, () => 0.9);
  assert.equal(v.tailN, TAIL_MIN_N);
  assert.ok(!v.reasons.includes('tail_untested'), JSON.stringify(v));
});

test('assessValidation: Tail an zu wenigen Tagen → tail_untested', () => {
  const t = makeTest(VALIDATED_MIN_TEST, { fc: TAIL_MIN_MS - 1 });
  for (let i = 0; i < TAIL_MIN_N; i++) t[i].row.fc_wind_ms = TAIL_MIN_MS;
  const v = assessValidation(t, () => 0.9);
  assert.ok(TAIL_MIN_DAYS > 2);
  assert.ok(v.reasons.includes('tail_untested'));
});

test('assessValidation: Lead 0/24/48 derselben Stunde zählen nur einmal', () => {
  const base = makeTest(VALIDATED_MIN_TEST - 50);
  const tripled = [...base, ...base, ...base];
  assert.ok(assessValidation(tripled, () => 0.9).reasons.includes('few_samples'));
});

test('assessValidation: NaN-Vorhersage gilt nie als validiert', () => {
  const v = assessValidation(makeTest(VALIDATED_MIN_TEST), () => NaN);
  assert.equal(v.tier, 'provisional');
  assert.ok(v.reasons.includes('tail_worse'));
});

test('assessValidation: mehrere ausgelieferte Pfade — der schlechteste entscheidet', () => {
  const t = makeTest(VALIDATED_MIN_TEST);
  assert.equal(assessValidation(t, [() => 0.9, () => 0.9]).tier, 'validated');
  assert.ok(assessValidation(t, [() => 0.9, () => -2]).reasons.includes('tail_worse'));
});

test('assessValidation: Modell im Tail schlechter als Rohprognose → tail_worse', () => {
  const v = assessValidation(makeTest(VALIDATED_MIN_TEST, { y: 1 }), () => -2);
  assert.equal(v.tier, 'provisional');
  assert.ok(v.reasons.includes('tail_worse'));
  assert.ok(v.maeModelTail > v.maeRawTail);
});

test('validationTier: Altbestand ohne Tier gilt als provisional', () => {
  assert.deepEqual(validationTier({ active: true }), { tier: 'provisional', tierReasons: ['not_assessed'] });
  assert.deepEqual(validationTier({ tier: 'validated', reasons: [] }), { tier: 'validated', tierReasons: [] });
  assert.equal(validationTier(null).tier, 'provisional');
});

const NOW = Date.parse('2026-06-15T12:00:00Z');
function liveRows(n, bias) {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(NOW - (i + 1) * 3600e3).toISOString(), fc_lead_hours: 0, hour_local: i % 24, bias_ms: bias,
  }));
}

test('computeDrift: zu wenige Live-Zeilen → insufficient', () => {
  assert.equal(computeDrift(liveRows(5, 1), new Array(24).fill(1), { now: NOW }).status, 'insufficient');
});

test('computeDrift: Tabelle trifft den Bias → ok', () => {
  const d = computeDrift(liveRows(100, 1), new Array(24).fill(1), { now: NOW });
  assert.equal(d.status, 'ok');
  assert.equal(d.maeCorrected, 0);
});

test('computeDrift: Tabelle verschlechtert die Rohprognose → drifting', () => {
  const d = computeDrift(liveRows(100, 0.5), new Array(24).fill(-2), { now: NOW });
  assert.equal(d.status, 'drifting');
  assert.ok(d.maeCorrected > d.maeRaw);
});

test('computeDrift: Zeilen außerhalb des Fensters zählen nicht', () => {
  const old = liveRows(100, 1).map(r => ({ ...r, ts: '2025-01-01T00:00:00.000Z' }));
  assert.equal(computeDrift(old, new Array(24).fill(1), { now: NOW }).status, 'insufficient');
});

test('prioritizeStations: Prioritäts-Keys zuerst, Rest stabil in Ursprungsreihenfolge', () => {
  const st = ['AAAA', 'LIEC', 'BBBB', 'LIEO', 'CCCC', 'LIEE'].map(key => ({ key }));
  assert.deepEqual(prioritizeStations(st).map(s => s.key), ['LIEO', 'LIEE', 'LIEC', 'AAAA', 'BBBB', 'CCCC']);
});

test('prioritizeStations: eigene Keys, mutiert die Eingabe nicht', () => {
  const st = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];
  assert.deepEqual(prioritizeStations(st, ['C']).map(s => s.key), ['C', 'A', 'B']);
  assert.deepEqual(st.map(s => s.key), ['A', 'B', 'C']);
  assert.equal(DEFAULT_PRIORITY_KEYS[0], 'LIEO');
});

test('computeDrift: nur Lead 0 zählt, Produktions-Zeitformat (:00:00Z) wird verglichen', () => {
  const rows = liveRows(100, 1).map(r => ({ ...r, ts: r.ts.replace('.000Z', 'Z') }));
  const mixed = [...rows, ...rows.map(r => ({ ...r, fc_lead_hours: 24, bias_ms: 5 }))];
  const d = computeDrift(mixed, new Array(24).fill(1), { now: NOW });
  assert.equal(d.status, 'ok');
  assert.equal(d.n, 100);
});
