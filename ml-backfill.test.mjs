/**
 * ml-backfill.test.mjs
 * v3.42.0 — historischer Backfill (src/ml_backfill.mjs).
 * Kein Test geht ins Netz: fetchImpl + fetchEnsemble werden injiziert.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  RateLimitError, parseMeteostatHourlyCsv, parseIemAsosCsv, hourlyFromReports,
  isModelSource, finalStatus, chunkDue, omWeight, createBudget,
  fetchMeteostatHourly, fetchIemAsos, iemAsosUrl, fetchHistoricalFeatures, fetchPreviousRunFeatures,
  pairHistory, monthChunks, backfillStation, runBackfill,
} from './src/ml_backfill.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, 'db', 'migrations');

function buildDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
  }
  return db;
}

const ab = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const resp = (status, { json, text, buf } = {}) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => json, text: async () => text, arrayBuffer: async () => ab(buf),
});

// ── Parser ──────────────────────────────────────────────────────────────────

test('parseMeteostatHourlyCsv: km/h → m/s, UTC-ts, leere wspd übersprungen', () => {
  const csv = [
    '2025-07-01,0,24.1,15,60,0,,320,18.0,36.0,1012,,2',
    '2025-07-01,13,30,15,40,0,,330,,,1010,,1',
    '2025-07-01,14,30,15,40,0,,10,7.2,,1010,,1',
    '',
  ].join('\n');
  const m = parseMeteostatHourlyCsv(csv);
  assert.deepEqual([...m.keys()], ['2025-07-01T00:00:00Z', '2025-07-01T14:00:00Z']);
  assert.deepEqual(m.get('2025-07-01T00:00:00Z'), { wind_ms: 5, gust_ms: 10, dir_deg: 320, source: 'meteostat' });
  assert.equal(m.get('2025-07-01T14:00:00Z').gust_ms, null);
});

test('parseIemAsosCsv: kn → m/s, "null" = fehlend, Header ignoriert', () => {
  const csv = 'station,valid,sknt,gust,drct\nLGKL,2025-07-01 11:50,10.00,20.00,310.00\nLGKL,2025-07-01 12:20,null,null,null\nLGKL,2025-07-01 12:50,8.00,null,300.00\n';
  const r = parseIemAsosCsv(csv);
  assert.equal(r.length, 2);
  assert.equal(r[0].t, Date.parse('2025-07-01T11:50:00Z'));
  assert.equal(r[0].wind_ms, 5.14);
  assert.equal(r[0].gust_ms, 10.29);
  assert.equal(r[1].gust_ms, null);
});

test('hourlyFromReports: :50 zählt zur nächsten Stunde, min |Δ| gewinnt, >30 min verworfen', () => {
  const T = s => Date.parse(`2025-07-01T${s}:00Z`);
  const reports = [
    { t: T('11:50'), wind_ms: 1 },
    { t: T('12:05'), wind_ms: 2 },   // näher an 12:00 als 11:50
    { t: T('12:50'), wind_ms: 3 },   // → 13:00
    { t: T('14:45'), wind_ms: 4 },   // → 15:00 (15 min)
  ];
  const h = hourlyFromReports(reports);
  assert.deepEqual([...h.keys()], ['2025-07-01T12:00:00Z', '2025-07-01T13:00:00Z', '2025-07-01T15:00:00Z']);
  assert.equal(h.get('2025-07-01T12:00:00Z').wind_ms, 2);
  assert.equal(h.get('2025-07-01T13:00:00Z').wind_ms, 3);
  assert.equal(h.get('2025-07-01T13:00:00Z').source, 'iem');
});

// ── Fetcher ─────────────────────────────────────────────────────────────────

test('fetchMeteostatHourly: gunzip, 404 → leer, 429 → RateLimitError', async () => {
  const gz = gzipSync(Buffer.from('2025-07-01,5,20,10,50,0,,200,10.8,,1010,,1\n'));
  const m = await fetchMeteostatHourly('16726', async url => {
    assert.match(url, /^https:\/\/data\.meteostat\.net\/hourly\/2025\/16726\.csv\.gz$/);
    return resp(200, { buf: gz });
  }, { sinceDay: '2025-07-01', endDay: '2025-07-31' });
  assert.equal(m.get('2025-07-01T05:00:00Z').wind_ms, 3);
  assert.equal((await fetchMeteostatHourly('x', async () => resp(404))).size, 0);
  await assert.rejects(fetchMeteostatHourly('x', async () => resp(429)), RateLimitError);
});

test('iemAsosUrl: Enddatum exklusiv (+1 Tag), Pflichtparameter gesetzt', () => {
  const u = new URL(iemAsosUrl('LGKL', '2025-02-01', '2025-02-28'));
  assert.equal(u.searchParams.get('station'), 'LGKL');
  assert.deepEqual(u.searchParams.getAll('data'), ['sknt', 'gust', 'drct']);
  assert.deepEqual([u.searchParams.get('year2'), u.searchParams.get('month2'), u.searchParams.get('day2')], ['2025', '3', '1']);
  assert.equal(u.searchParams.get('tz'), 'Etc/UTC');
  assert.deepEqual(u.searchParams.getAll('report_type'), ['3', '4']);
});

test('fetchIemAsos liefert stündliche Map', async () => {
  const m = await fetchIemAsos('LGKL', '2025-07-01', '2025-07-01',
    async () => resp(200, { text: 'station,valid,sknt,gust,drct\nLGKL,2025-07-01 11:50,10,null,300\n' }));
  assert.equal(m.get('2025-07-01T12:00:00Z').wind_ms, 5.14);
});

test('fetchHistoricalFeatures: Map ts→Features, GMT-Zeit, 429 → RateLimitError', async () => {
  let seen;
  const json = { hourly: {
    time: ['2025-07-01T00:00', '2025-07-01T01:00'],
    wind_speed_10m: [4.2, null], wind_direction_10m: [300, 310],
    surface_pressure: [1010, 1011], temperature_2m: [25, 24], cape: [0, 10],
  } };
  const m = await fetchHistoricalFeatures(36.9, 21.7, '2025-07-01', '2025-07-01', async url => { seen = new URL(url); return resp(200, { json }); });
  assert.equal(seen.searchParams.get('timezone'), 'GMT');
  assert.equal(seen.searchParams.get('wind_speed_unit'), 'ms');
  assert.deepEqual([...m.keys()], ['2025-07-01T00:00:00Z']);
  assert.deepEqual(m.get('2025-07-01T00:00:00Z'), { fc_wind_ms: 4.2, fc_dir_deg: 300, fc_pressure_hpa: 1010, fc_temp_c: 25, fc_cape: 0 });
  await assert.rejects(fetchHistoricalFeatures(0, 0, 'a', 'b', async () => resp(429)), RateLimitError);
});

test('fetchPreviousRunFeatures: lead 24/48 je ts; 400 → leer; fehlende Variable toleriert; 429 wirft', async () => {
  const json = { hourly: {
    time: ['2025-07-01T00:00', '2025-07-01T01:00'],
    wind_speed_10m_previous_day1: [5, 6], wind_direction_10m_previous_day1: [300, 301],
    temperature_2m_previous_day1: [20, 21], surface_pressure_previous_day1: [1000, 1001],
    wind_speed_10m_previous_day2: [7, null],
  } };
  const m = await fetchPreviousRunFeatures(0, 0, 'a', 'b', async () => resp(200, { json }));
  const a = m.get('2025-07-01T00:00:00Z');
  assert.equal(a[24].fc_wind_ms, 5);
  assert.equal(a[24].fc_pressure_hpa, 1000);
  assert.equal(a[48].fc_wind_ms, 7);
  assert.equal(a[48].fc_dir_deg, null);
  assert.equal(m.get('2025-07-01T01:00:00Z')[48], undefined);
  assert.equal((await fetchPreviousRunFeatures(0, 0, 'a', 'b', async () => resp(400, { json: { error: true } }))).size, 0);
  await assert.rejects(fetchPreviousRunFeatures(0, 0, 'a', 'b', async () => resp(429)), RateLimitError);
});

// ── Pairing ─────────────────────────────────────────────────────────────────

test('pairHistory: lead 0/24/48 auf demselben Ziel-ts, bias = obs − fc, Ausreißer verworfen', () => {
  const ts = '2025-07-01T12:00:00Z';
  const obsByTs = new Map([[ts, { wind_ms: 8.123, gust_ms: 11, dir_deg: 320, source: 'iem' }],
                           ['2025-07-01T13:00:00Z', { wind_ms: 30, source: 'iem' }]]);
  const fc0 = new Map([[ts, { fc_wind_ms: 6, fc_dir_deg: 310, fc_pressure_hpa: 1012, fc_temp_c: 27, fc_cape: 5 }],
                       ['2025-07-01T13:00:00Z', { fc_wind_ms: 5 }]]);
  const prev = new Map([[ts, { 24: { fc_wind_ms: 7 }, 48: { fc_wind_ms: 9 } }]]);
  const ens = new Map([[ts, 6.5]]);
  const rows = pairHistory({ stationKey: 'LGKL', tz: 'Europe/Athens', obsByTs, fc0, prev, ens });
  assert.equal(rows.length, 3, 'bias 25 m/s → verworfen');
  const [r0, r24, r48] = rows;
  assert.deepEqual([r0.fc_lead_hours, r24.fc_lead_hours, r48.fc_lead_hours], [0, 24, 48]);
  assert.ok(rows.every(r => r.ts === ts && r.obs_wind_ms === 8.12 && r.source === 'iem'));
  assert.equal(r0.bias_ms, 2.12);
  assert.equal(r24.bias_ms, 1.12);
  assert.equal(r48.bias_ms, -0.88);
  assert.equal(r0.fc_ens_wind_ms, 6.5);
  assert.equal(r24.fc_ens_wind_ms, null);
  assert.equal(r0.hour_local, 15, 'Athen Sommer = UTC+3');
  assert.equal(r0.month, 7);
});

test('pairHistory: DST-Ende Europe/Athens (26.10.2025) — zwei UTC-Stunden → beide lokal 03 Uhr', () => {
  const tsA = '2025-10-26T00:00:00Z', tsB = '2025-10-26T01:00:00Z', tsC = '2025-10-31T22:00:00Z';
  const obsByTs = new Map([tsA, tsB, tsC].map(t => [t, { wind_ms: 5, source: 'meteostat' }]));
  const fc0 = new Map([tsA, tsB, tsC].map(t => [t, { fc_wind_ms: 4 }]));
  const rows = pairHistory({ stationKey: 'k', tz: 'Europe/Athens', obsByTs, fc0 });
  assert.deepEqual(rows.map(r => r.hour_local), [3, 3, 0]);
  assert.deepEqual(rows.map(r => r.month), [10, 10, 11], '31.10. 22Z ist lokal schon November');
});

// ── Chunks ──────────────────────────────────────────────────────────────────

test('monthChunks: ganze Monate, letzter endet an endDay', () => {
  const c = monthChunks('2025-03-15', 3);
  assert.deepEqual(c.map(x => [x.chunk, x.startDay, x.endDay, x.complete]), [
    ['2025-01', '2025-01-01', '2025-01-31', true],
    ['2025-02', '2025-02-01', '2025-02-28', true],
    ['2025-03', '2025-03-01', '2025-03-15', false],
  ]);
});

// ── backfillStation ─────────────────────────────────────────────────────────

const ST = { key: 'LGKL', meteostatId: '16722', icao: 'LGKL', lat: 37.07, lon: 22.03, tz: 'Europe/Athens' };

function hoursOf(day) { return Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`); }
function daysBetween(a, b) {
  const out = [];
  for (let d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// Fake-Netz: Meteostat liefert jeden Tag 12 UTC, IEM jeden Tag 14:50, Modelle jede Stunde.
function fakeNet({ rateLimitFrom = null } = {}) {
  const calls = [];
  let fcCalls = 0;
  const fetchImpl = async url => {
    calls.push(url);
    const u = new URL(url);
    if (u.host === 'data.meteostat.net') {
      const lines = daysBetween('2025-01-01', '2025-03-31').map(d => `${d},12,10,5,50,0,,200,18,,1010,,1`);
      return resp(200, { buf: gzipSync(Buffer.from(lines.join('\n'))) });
    }
    if (u.host === 'mesonet.agron.iastate.edu') {
      const day = n => `${u.searchParams.get(`year${n}`)}-${u.searchParams.get(`month${n}`).padStart(2, '0')}-${u.searchParams.get(`day${n}`).padStart(2, '0')}`;
      const lines = daysBetween(day(1), day(2)).slice(0, -1).map(d => `LGKL,${d} 14:50,10,null,300`);
      return resp(200, { text: `station,valid,sknt,gust,drct\n${lines.join('\n')}\n` });
    }
    const sd = u.searchParams.get('start_date'), ed = u.searchParams.get('end_date');
    const time = daysBetween(sd, ed).flatMap(hoursOf);
    if (u.host.startsWith('historical-forecast')) {
      fcCalls++;
      if (rateLimitFrom != null && fcCalls >= rateLimitFrom) return resp(429);
      return resp(200, { json: { hourly: { time, wind_speed_10m: time.map(() => 4) } } });
    }
    if (u.host.startsWith('previous-runs')) {
      return resp(200, { json: { hourly: { time, wind_speed_10m_previous_day1: time.map(() => 3) } } });
    }
    throw new Error(`unerwartete URL ${url}`);
  };
  return { fetchImpl, calls };
}

const fakeEnsemble = async (st, startDay, endDay) => {
  assert.equal(st.tz, 'GMT');
  return { byKey: new Map(daysBetween(startDay, endDay).map(d => [`${d}|12`, 4.5])) };
};

test('backfillStation: schreibt alle Chunks, IEM > Meteostat, Resume schreibt nichts neu', async () => {
  const db = buildDb();
  const net = fakeNet();
  const opts = { months: 3, endDay: '2025-03-31', fetchImpl: net.fetchImpl, sleepMs: 0, fetchEnsemble: fakeEnsemble };

  const r1 = await backfillStation(db, ST, opts);
  // 90 Tage × (Meteostat 12Z + IEM 15Z) × (lead 0 + lead 24)
  assert.deepEqual(r1, { station: 'LGKL', chunks: 3, rows: 90 * 2 * 2, skipped: 0, errors: 0 });
  const prog = db.prepare('SELECT chunk, status, rows FROM ml_backfill_progress ORDER BY chunk').all();
  assert.deepEqual(prog.map(p => p.status), ['done', 'done', 'done']);

  const row12 = db.prepare("SELECT * FROM ml_history WHERE ts='2025-01-15T12:00:00Z' AND fc_lead_hours=0").get();
  assert.equal(row12.source, 'meteostat');
  assert.equal(row12.obs_wind_ms, 5);
  assert.equal(row12.fc_ens_wind_ms, 4.5);
  assert.equal(row12.bias_ms, 1);
  const row15 = db.prepare("SELECT * FROM ml_history WHERE ts='2025-01-15T15:00:00Z' AND fc_lead_hours=24").get();
  assert.equal(row15.source, 'iem');
  assert.equal(row15.bias_ms, 2.14);

  const before = net.calls.length;
  const r2 = await backfillStation(db, ST, opts);
  assert.deepEqual(r2, { station: 'LGKL', chunks: 0, rows: 0, skipped: 3, errors: 0 });
  assert.equal(net.calls.length, before, 'zweiter Lauf: kein einziger Request');
});

test('backfillStation: laufender Monat bleibt partial und wird erneut geholt', async () => {
  const db = buildDb();
  const net = fakeNet();
  const opts = { months: 1, endDay: '2025-03-15', fetchImpl: net.fetchImpl, sleepMs: 0, fetchEnsemble: fakeEnsemble };
  await backfillStation(db, ST, opts);
  assert.equal(db.prepare("SELECT status FROM ml_backfill_progress WHERE chunk='2025-03'").get().status, 'partial');
  const early = await backfillStation(db, ST, { ...opts, endDay: '2025-03-31' });
  assert.equal(early.chunks, 0, 'partial wird nicht bei jedem Lauf neu bezahlt');
  const r = await backfillStation(db, ST, { ...opts, endDay: '2025-03-31', now: Date.now() + 8 * 864e5 });
  assert.equal(r.chunks, 1);
  assert.equal(db.prepare("SELECT status FROM ml_backfill_progress WHERE chunk='2025-03'").get().status, 'done');
});

test('backfillStation: RateLimitError lässt Chunk offen, runBackfill bricht ab und setzt später fort', async () => {
  const db = buildDb();
  const limited = fakeNet({ rateLimitFrom: 2 });
  const opts = { months: 3, endDay: '2025-03-31', sleepMs: 0, fetchEnsemble: fakeEnsemble };
  const other = { ...ST, key: 'ms:999', icao: null };

  const res = await runBackfill(db, [ST, other], { ...opts, fetchImpl: limited.fetchImpl });
  assert.equal(res.rateLimited, true);
  assert.equal(res.stoppedAt, 'LGKL');
  const prog = db.prepare('SELECT chunk, status FROM ml_backfill_progress ORDER BY chunk').all().map(r => ({ ...r }));
  assert.deepEqual(prog, [{ chunk: '2025-01', status: 'done' }], 'Februar bleibt ohne Eintrag');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ml_backfill_progress WHERE station_key='ms:999'").get().n, 0);

  const ok = fakeNet();
  const res2 = await runBackfill(db, [ST], { ...opts, fetchImpl: ok.fetchImpl });
  assert.equal(res2.rateLimited, false);
  assert.equal(res2.results[0].skipped, 1);
  assert.equal(res2.results[0].chunks, 2);
});

test('backfillStation: Ensemble-Fehler → Zeilen ja, Chunk partial (nicht still done); HTTP-Fehler → error', async () => {
  const db = buildDb();
  const net = fakeNet();
  const broken = async () => { throw new Error('app.jsx fehlt'); };
  const r = await backfillStation(db, { ...ST, icao: null }, { months: 1, endDay: '2025-01-31', fetchImpl: net.fetchImpl, sleepMs: 0, fetchEnsemble: broken });
  assert.equal(r.rows, 31 * 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ml_history WHERE fc_ens_wind_ms IS NOT NULL').get().n, 0);
  assert.deepEqual({ ...db.prepare('SELECT status, error FROM ml_backfill_progress').get() },
                   { status: 'partial', error: 'ensemble' });

  const db2 = buildDb();
  const failing = async url => (new URL(url).host.startsWith('historical-forecast') ? resp(500, { json: { reason: 'boom' } }) : net.fetchImpl(url));
  const r2 = await backfillStation(db2, { ...ST, icao: null }, { months: 1, endDay: '2025-01-31', fetchImpl: failing, sleepMs: 0, fetchEnsemble: fakeEnsemble });
  assert.equal(r2.errors, 1);
  assert.deepEqual({ ...db2.prepare('SELECT status, error FROM ml_backfill_progress').get() }, { status: 'error', error: 'boom' });
});

// ── v1.1: Datenqualität, Budget, Ausfälle ──────────────────────────────────

test('parseMeteostatHourlyCsv: neues Format mit Header, Spalten per Name, Modellquellen verworfen', () => {
  const csv = [
    'year,month,day,hour,temp,wdir,wspd,wpgt,pres,wspd_source,temp_source',
    '2025,7,1,5,20,200,10.8,18,1010,synop,synop',
    '2025,7,1,6,20,210,14.4,,1010,mosmix,mosmix',
    '2025,7,1,7,21,220,7.2,,1010,metno_forecast,metar',
    '2025,7,1,8,22,230,3.6,,1010,metar,metar',
  ].join('\n');
  const stats = new Map();
  const m = parseMeteostatHourlyCsv(csv, { stats });
  assert.deepEqual([...m.keys()], ['2025-07-01T05:00:00Z', '2025-07-01T08:00:00Z']);
  assert.equal(m.get('2025-07-01T05:00:00Z').wind_ms, 3);
  assert.equal(m.get('2025-07-01T05:00:00Z').dir_deg, 200);
  assert.equal(stats.get('mosmix'), 1);
  assert.equal(isModelSource('synop'), false);
  assert.equal(isModelSource('MOSMIX'), true);
});

test('parseMeteostatHourlyCsv: ISO-time-Spalte und sinceDay', () => {
  const csv = 'time,wspd,wdir\n2024-12-31 23:00:00,3.6,90\n2025-01-01 00:00:00,7.2,100\n';
  const m = parseMeteostatHourlyCsv(csv, { sinceDay: '2025-01-01' });
  assert.deepEqual([...m.keys()], ['2025-01-01T00:00:00Z']);
});

test('parseIemAsosCsv ordnet Spalten über den Header zu', () => {
  const r = parseIemAsosCsv('station,valid,drct,gust,sknt\nLGKL,2025-02-01 13:50,300,null,10\n');
  assert.equal(r[0].wind_ms, 5.14);
  assert.equal(r[0].dir_deg, 300);
});

test('finalStatus / chunkDue', () => {
  const c = { chunk: '2025-01', endDay: '2025-01-31', complete: true };
  assert.equal(finalStatus(c, { rows: 10, coverage: 1 }, '2025-03-01'), 'done');
  assert.equal(finalStatus(c, { rows: 10, coverage: 0.5 }, '2025-03-01'), 'partial');
  assert.equal(finalStatus(c, { rows: 10, coverage: 0.5 }, '2025-12-01'), 'done', 'alter Monat: Lücke ist final');
  assert.equal(finalStatus({ ...c, chunk: '2023-05', endDay: '2023-05-31' }, { rows: 10, prevOk: false }, '2023-07-01'),
               'done', 'vor 2024: previous-runs leer ist ok');
  assert.equal(finalStatus({ ...c, chunk: '2025-05' }, { rows: 10, prevOk: false }, '2025-07-01'), 'partial');
  const now = Date.parse('2025-03-10T00:00:00Z');
  assert.equal(chunkDue(null, now), true);
  assert.equal(chunkDue({ status: 'done', updated_at: '2025-01-01T00:00:00Z' }, now), false);
  assert.equal(chunkDue({ status: 'partial', updated_at: '2025-03-05T00:00:00Z' }, now), false);
  assert.equal(chunkDue({ status: 'partial', updated_at: '2025-03-01T00:00:00Z' }, now), true);
  assert.equal(chunkDue({ status: 'error', updated_at: '2025-03-08T00:00:00Z' }, now), true);
});

test('Budget: Gewichtsformel, Stopp vor dem Limit, Zähler persistiert je Tag', async () => {
  assert.equal(omWeight({ days: 31, variables: 5 }), 31 / 14);
  assert.equal(omWeight({ days: 7, variables: 16 }), 1.6);
  assert.equal(omWeight({ days: 28, variables: 1, models: 6 }), 12);
  const db = buildDb();
  const now = Date.parse('2025-04-01T10:00:00Z');
  const b = createBudget(db, { max: 10, now });
  b.spend(6);
  assert.throws(() => b.spend(5), e => e instanceof RateLimitError && e.reason === 'budget');
  assert.equal(createBudget(db, { max: 10, now }).used, 6, 'gleicher Tag: Zähler bleibt');
  assert.equal(createBudget(db, { max: 10, now: now + 864e5 }).used, 0, 'neuer Tag: Reset');

  const net = fakeNet();
  const res = await runBackfill(db, [ST], { months: 3, endDay: '2025-03-31', fetchImpl: net.fetchImpl, sleepMs: 0,
    fetchEnsemble: fakeEnsemble, budget: createBudget(db, { max: 5, now: now + 2 * 864e5 }) });
  assert.equal(res.rateLimited, true);
  assert.equal(res.reason, 'budget');
});

test('Meteostat-Ausfall: ohne ICAO bricht die Station ab, Chunks bleiben offen', async () => {
  const db = buildDb();
  const net = fakeNet();
  const down = async url => (new URL(url).host === 'data.meteostat.net' ? resp(503) : net.fetchImpl(url));
  const r = await backfillStation(db, { ...ST, key: 'ms:1', icao: null }, { months: 2, endDay: '2025-02-28', fetchImpl: down, sleepMs: 0, fetchEnsemble: fakeEnsemble });
  assert.equal(r.errors, 1);
  assert.match(r.error, /meteostat_unavailable/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ml_backfill_progress').get().n, 0);
  const r2 = await backfillStation(db, ST, { months: 1, endDay: '2025-01-31', fetchImpl: down, sleepMs: 0, fetchEnsemble: fakeEnsemble });
  assert.equal(r2.errors, 0, 'mit ICAO: weiter mit IEM');
  assert.ok(r2.rows > 0);
});
