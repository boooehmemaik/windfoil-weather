/**
 * ml-e2e-gialova.test.mjs  (v1.0.0 · App v3.42.0)
 * Phase-5-E2E mit Navarino/Gialova-Demodaten: Discovery → 3-Monats-Backfill →
 * History-MOS → Neural-MOS (Eval-Gate) → Spot-Lookup für /api/station/mos.
 *
 * Szenario: Methoni (WMO 16754, ~13 km) misst die SW-Seebrise am Nachmittag
 * stärker, als das Modell sie vorhersagt; Kalamata (LGKL, ~32 km) wäre die
 * ICAO-Alternative, liegt aber zu weit weg → die 10–20-km-Regel muss greifen.
 * Netz komplett simuliert (fetchImpl), deterministisch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTRA_SPOTS, collectSpots, assignStations, listMlStations,
         findMlStationForSpot, parseMeteostatCatalog } from './src/ml_stations.mjs';
import { runBackfill } from './src/ml_backfill.mjs';
import { runMosJob, markObsEpoch, getMosBias } from './src/mos.mjs';
import { trainNeuralMos, getNeuralEval, predictSituational } from './src/neural_mos.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GIALOVA = { lat: 36.9485, lon: 21.6953 };
const END_DAY = '2026-10-31';
const NOW = new Date('2026-11-01T12:00:00Z');

function freshDb() {
  const db = new Database(':memory:');
  const dir = join(ROOT, 'db', 'migrations');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort())
    db.exec(readFileSync(join(dir, f), 'utf8'));
  return db;
}

const CATALOG = [
  { id: '16754', name: { en: 'Methoni' }, country: 'GR', identifiers: { wmo: '16754', icao: null },
    location: { latitude: 36.8333, longitude: 21.7000, elevation: 52 }, timezone: 'Europe/Athens',
    inventory: { hourly: { start: '2000-01-01', end: '2026-10-31' } } },
  { id: '16726', name: { en: 'Kalamata Airport' }, country: 'GR', identifiers: { wmo: '16726', icao: 'LGKL' },
    location: { latitude: 37.0683, longitude: 22.0253, elevation: 6 }, timezone: 'Europe/Athens',
    inventory: { hourly: { start: '2000-01-01', end: '2026-10-31' } } },
  { id: 'OLD01', name: { en: 'Pylos (stillgelegt)' }, country: 'GR', identifiers: {},
    location: { latitude: 36.915, longitude: 21.696 }, timezone: 'Europe/Athens',
    inventory: { hourly: { start: '1990-01-01', end: '2012-12-31' } } },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 2 ** 32);
}

// Modell: 3–6 m/s. Station: nachmittags (13–17 h Athen = 10–14 UTC) +2.8 m/s
// Seebrise, nachts −0.5. Gleiches Muster für Modell- und Stationsseite.
const DAYS = (() => {
  const out = [];
  for (let t = Date.parse('2026-08-01T00:00:00Z'); t <= Date.parse(`${END_DAY}T00:00:00Z`); t += 864e5)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
})();
const rand = rng(7);
const MODEL = new Map(), OBS = new Map(), DIR = new Map();
for (const d of DAYS) {
  // Seebrise nur bei SW-Lage; bei Nordlage (Meltemi-Ausläufer) deckt die Küste ab.
  const sw = rand() < 0.6;
  for (let h = 0; h < 24; h++) {
    const ts = `${d}T${String(h).padStart(2, '0')}:00`;
    const fc = 3 + 3 * rand();
    const pm = h >= 10 && h <= 14;
    const sys = pm ? (sw ? 3.2 : -0.8) : -0.5;
    MODEL.set(ts, Math.round(fc * 100) / 100);
    DIR.set(ts, sw ? 225 : 20);
    OBS.set(ts, Math.max(0, fc + sys + (rand() - 0.5)));
  }
}

function meteostatCsv() {
  return [...OBS].map(([ts, w]) =>
    [ts.slice(0, 10), +ts.slice(11, 13), 24, 15, 60, 0, '', 225, (w * 3.6).toFixed(1), '', 1012, '', 2].join(','))
    .join('\n');
}

function hourlyJson(url, prev) {
  const u = new URL(url);
  const s = u.searchParams.get('start_date'), e = u.searchParams.get('end_date');
  const time = [...MODEL.keys()].filter(t => t.slice(0, 10) >= s && t.slice(0, 10) <= e);
  const w = time.map(t => MODEL.get(t));
  const h = { time };
  if (prev) {
    h.wind_speed_10m_previous_day1 = w.map(x => x * 0.95);
    h.wind_speed_10m_previous_day2 = w.map(x => x * 0.9);
    h.wind_direction_10m_previous_day1 = time.map(t => DIR.get(t));
    h.wind_direction_10m_previous_day2 = time.map(t => DIR.get(t));
  } else {
    Object.assign(h, { wind_speed_10m: w, wind_direction_10m: time.map(t => DIR.get(t)),
      surface_pressure: time.map(() => 1012), temperature_2m: time.map(() => 24), cape: time.map(() => 80) });
  }
  return h;
}

const calls = [];
async function fetchImpl(url) {
  calls.push(url);
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => String(body),
                        arrayBuffer: async () => body });
  if (url.startsWith('https://data.meteostat.net/hourly/2026/16754.csv.gz')) { const b = gzipSync(meteostatCsv()); return ok(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  if (url.includes('historical-forecast-api')) return ok({ hourly: hourlyJson(url, false) });
  if (url.includes('previous-runs-api')) return ok({ hourly: hourlyJson(url, true) });
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
}

// Ensemble-Median = Modell (Test braucht kein app.jsx-vm)
async function fetchEnsemble(st, startDay, endDay) {
  const byKey = new Map();
  for (const [ts, w] of MODEL) if (ts.slice(0, 10) >= startDay && ts.slice(0, 10) <= endDay)
    byKey.set(`${ts.slice(0, 10)}|${+ts.slice(11, 13)}`, w);
  return { byKey, members: ['test'], n: byKey.size };
}

test('E2E Gialova: Discovery → Backfill → MOS → Neural → Spot-Lookup', async () => {
  const db = freshDb();
  const catalog = parseMeteostatCatalog(JSON.stringify(CATALOG));

  // 1) Discovery — nur der Gialova-Spot
  const spots = collectSpots({ extraSpots: EXTRA_SPOTS.filter(s => /Gialova|Navarino/i.test(s.name)) });
  assert.equal(spots.length, 1);
  const disc = assignStations(db, spots, catalog, { now: NOW.getTime() });
  assert.equal(disc.stations.length, 1);
  assert.equal(disc.stations[0].key, 'ms:16754', '13 km Methoni schlägt 32 km LGKL; stillgelegte Station ignoriert');
  const [st] = listMlStations(db);
  assert.ok(st.km > 10 && st.km < 15, `km=${st.km}`);

  // 2) Backfill 3 Monate
  const progress = [];
  const bf = await runBackfill(db, [st], { months: 3, endDay: END_DAY, fetchImpl, sleepMs: 0,
                                           fetchEnsemble, onProgress: p => progress.push(p) });
  assert.equal(bf.ok, true);
  const n0 = db.prepare(`SELECT COUNT(*) n FROM ml_history WHERE station_key=? AND fc_lead_hours=0`).get(st.key).n;
  assert.ok(n0 > 24 * 85, `lead0=${n0}`);
  assert.ok(db.prepare(`SELECT COUNT(*) n FROM ml_history WHERE fc_lead_hours=48`).get().n > 0);
  assert.ok(progress.some(p => p.chunk === '2026-09'), 'Fortschritt je Monats-Chunk');
  assert.equal(progress.at(-1).done, 1);
  // Zweiter Lauf: alles 'done' → keine neuen Requests
  const before = calls.length;
  await runBackfill(db, [st], { months: 3, endDay: END_DAY, fetchImpl, sleepMs: 0, fetchEnsemble });
  assert.equal(calls.length, before, 'Resume: kein erneuter Download');

  // 3) Linearer MOS aus der Historie (keine Live-Obs vorhanden)
  markObsEpoch(db, '2026-01-01T00:00:00Z');
  const mos = await runMosJob(db, [{ key: st.key, lat: st.lat, lon: st.lon, tz: st.tz }],
                              { now: NOW, endDay: END_DAY, fetchImpl });
  const r = mos.results[0];
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.source, 'history');
  const bias = getMosBias(db, st.key);
  assert.ok(bias.hours[15].n >= 8, `n15=${bias.hours[15].n}`);
  assert.ok(bias.hours[15].biasMs > 0.8, `15 h Athen: ${bias.hours[15].biasMs}`);
  assert.ok(bias.hours[3].biasMs < 0, `03 h Athen: ${bias.hours[3].biasMs}`);

  // 4) Neural-MOS mit Eval-Gate: Richtung trennt Seebrise/Abdeckung → muss linear schlagen
  const nr = trainNeuralMos(db, st.key, { now: NOW });
  assert.equal(nr.ok, true);
  const ev = getNeuralEval(db, st.key);
  assert.equal(nr.activeFc, true, JSON.stringify(ev));
  assert.ok(ev.maeModel < ev.maeLinear, `model ${ev.maeModel} vs linear ${ev.maeLinear}`);

  // 4b) Situativ für die nächsten Tage: morgen SW-Lage, übermorgen Nordlage
  const time = [], wind = [], dir = [];
  for (let d = 0; d < 3; d++) for (let h = 0; h < 24; h++) {
    time.push(`2026-11-0${1 + d}T${String(h).padStart(2, '0')}:00`); wind.push(4); dir.push(d === 1 ? 225 : 20);
  }
  const fc72 = { issuedAt: '2026-11-01T00:00:00Z', hourly: { time, windspeed_10m: wind, winddirection_10m: dir,
    surface_pressure: time.map(() => 1012), temperature_2m: time.map(() => 24), cape: time.map(() => 80) } };
  const sit = predictSituational(db, st.key, fc72, { tz: st.tz, now: Date.parse('2026-11-01T00:00:00Z') });
  assert.ok(sit['2026-11-02'][15] > 1.5, `SW-Tag 15 h: ${sit['2026-11-02'][15]}`);
  assert.ok(sit['2026-11-03'][15] < 0.5, `Nord-Tag 15 h: ${sit['2026-11-03'][15]}`);

  // 5) Spot-Lookup wie /api/station/mos ihn macht
  const hit = findMlStationForSpot(db, GIALOVA.lat, GIALOVA.lon);
  assert.equal(hit.key, 'ms:16754');
  assert.ok(hit.km > 10 && hit.km < 15);
  assert.equal(findMlStationForSpot(db, 48.07, 11.17), null, 'Wörthsee hat hier keine Station');
});
