/**
 * ml-live.test.mjs  (v1.0.0 · App v3.42.0)
 * Stündliches Batch-Polling der ML-Stationen: METAR-Parsing, Multi-Location-
 * Forecast, stundengenaue ml_samples. Netz komplett gemockt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hourTs, parseMetarBatch, parseForecastBatch, featuresAt, buildSamples, pollMlStationsOnce, chunk,
} from './src/ml_live.mjs';
import { loadTrainingRows } from './src/neural_mos.mjs';

const MIG = join(dirname(fileURLToPath(import.meta.url)), 'db', 'migrations');
function freshDb() {
  const db = new Database(':memory:');
  for (const m of ['006_station_obs', '007_station_mos_bias', '008_ml_samples', '009_ml_leadtime'])
    db.exec(readFileSync(join(MIG, `${m}.sql`), 'utf8'));
  return db;
}

const NOW = Date.parse('2026-11-14T10:05:00Z');
const ST = [
  { station_key: 'LGKL', icao: 'LGKL', live_source: 'metar', lat: 37.07, lon: 22.03, tz: 'Europe/Athens' },
  { station_key: 'EDMO', icao: 'EDMO', live_source: 'metar', lat: 48.08, lon: 11.28, tz: 'Europe/Berlin' },
  { station_key: 'ms:X', icao: null, live_source: null, lat: 1, lon: 1, tz: 'UTC' },
];

function hourly(startIso, n, wind = 4) {
  const t0 = Date.parse(startIso);
  const time = Array.from({ length: n }, (_, i) => new Date(t0 + i * 3600e3).toISOString().slice(0, 16));
  return { time, windspeed_10m: time.map(() => wind), winddirection_10m: time.map(() => 210),
           surface_pressure: time.map(() => 1011), temperature_2m: time.map(() => 18), cape: time.map(() => 50) };
}

test('hourTs rundet auf die nächste volle Stunde', () => {
  assert.equal(hourTs(Date.parse('2026-11-14T09:50:00Z')), '2026-11-14T10:00:00Z');
  assert.equal(hourTs(Date.parse('2026-11-14T10:20:00Z')), '2026-11-14T10:00:00Z');
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});

test('parseMetarBatch: jüngste Obs je ICAO, kn→m/s, VRB→null, zu alt verworfen', () => {
  const arr = [
    { icaoId: 'LGKL', obsTime: Date.parse('2026-11-14T09:20:00Z') / 1000, wspd: 8, wdir: 220 },
    { icaoId: 'LGKL', obsTime: Date.parse('2026-11-14T09:50:00Z') / 1000, wspd: 12, wgst: 20, wdir: 'VRB' },
    { icaoId: 'EDMO', obsTime: Date.parse('2026-11-14T07:50:00Z') / 1000, wspd: 5 },
    { icaoId: 'XXXX', obsTime: 'bad', wspd: 5 },
  ];
  const m = parseMetarBatch(arr, NOW);
  assert.equal(m.size, 1);
  const o = m.get('LGKL');
  assert.equal(o.wind_ms, 6.17);
  assert.equal(o.gust_ms, 10.29);
  assert.equal(o.dir_deg, null);
  assert.equal(o.hourTs, '2026-11-14T10:00:00Z');
});

test('parseForecastBatch akzeptiert Objekt (1 Ort) und Array (n Orte)', () => {
  const h = hourly('2026-11-14T00:00:00Z', 72);
  assert.equal(parseForecastBatch({ hourly: h }, [ST[0]]).size, 1);
  assert.equal(parseForecastBatch([{ hourly: h }, {}], ST.slice(0, 2)).size, 1);
  assert.equal(featuresAt(h, '2026-11-14T10:00:00Z').fc_wind_ms, 4);
  assert.equal(featuresAt(h, '2026-11-20T10:00:00Z'), null);
});

test('buildSamples: lead 0 mit Bias + lead 24/48 stundengenau, lokale Stunde', () => {
  const obs = { hourTs: '2026-11-14T10:00:00Z', wind_ms: 6, gust_ms: null };
  const rows = buildSamples(ST[0], obs, hourly('2026-11-14T00:00:00Z', 72, 4.5));
  assert.deepEqual(rows.map(r => r.lead), [0, 24, 48]);
  assert.equal(rows[0].bias_ms, 1.5);
  assert.equal(rows[0].hour, 12, 'Athen = UTC+2 im November');
  assert.equal(rows[1].ts, '2026-11-15T10:00:00Z');
  assert.equal(rows[2].obs, null);
});

test('pollMlStationsOnce: ein METAR- und ein Forecast-Request für alle, danach trainierbar gepaart', async () => {
  const db = freshDb();
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('aviationweather')) return { ok: true, json: async () => [
      { icaoId: 'LGKL', obsTime: Date.parse('2026-11-14T09:50:00Z') / 1000, wspd: 12 },
      { icaoId: 'EDMO', obsTime: Date.parse('2026-11-14T10:00:00Z') / 1000, wspd: 4 },
    ] };
    return { ok: true, json: async () => [{ hourly: hourly('2026-11-13T00:00:00Z', 96, 4) },
                                           { hourly: hourly('2026-11-13T00:00:00Z', 96, 2) }] };
  };
  const fc = [];
  const r = await pollMlStationsOnce(db, ST, { fetchImpl, nowMs: NOW, onForecast: (k, h, at) => fc.push([k, at]) });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('ids=LGKL,EDMO'));
  assert.ok(calls[1].includes('latitude=37.07%2C48.08%2C1'), 'Forecast auch für Nicht-ICAO-Stationen (situatives Neural)');
  assert.deepEqual(r, { polled: 2, obs: 2, samples: 6, forecasts: 2 });
  assert.deepEqual(fc.map(x => x[0]), ['LGKL', 'EDMO']);
  assert.equal(fc[0][1], '2026-11-14T10:05:00.000Z');
  // Zweiter Lauf in derselben Stunde: idempotent.
  const r2 = await pollMlStationsOnce(db, ST, { fetchImpl, nowMs: NOW });
  assert.equal(r2.samples, 0);

  // Eine lead-24-Prognose von gestern für genau diese Stunde paart sich exakt.
  db.prepare(`INSERT INTO ml_samples (station_key, ts, fc_lead_hours, hour_local, month, fc_wind_ms)
              VALUES ('LGKL','2026-11-14T10:00:00Z',24,12,11,3)`).run();
  const lead24 = loadTrainingRows(db, 'LGKL').filter(x => x.fc_lead_hours === 24 && x.ts.startsWith('2026-11-14'));
  assert.equal(lead24.length, 1);
  assert.equal(lead24[0].bias_ms, 3.17);
});
