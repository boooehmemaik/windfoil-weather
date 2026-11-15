/**
 * ml-stations.test.mjs
 * v3.42.0 — automatische Stationswahl je Spot (src/ml_stations.mjs).
 * Fixtures statt Netz; :memory:-DB mit allen Migrationen bis 013.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  EXTRA_SPOTS, parseMeteostatCatalog, loadMeteostatCatalog, collectSpots,
  rankCandidates, pickStation, stationKeyOf, assignStations, listMlStations, findMlStationForSpot,
} from './src/ml_stations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, 'db', 'migrations');

function buildDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
  }
  return db;
}

const NOW = Date.parse('2026-11-14T12:00:00Z');

function raw(id, lat, lon, { icao = null, end = '2026-11-01', name = id, tz = 'Europe/Athens' } = {}) {
  return {
    id, name: { en: name, de: `${name} DE` }, country: 'GR',
    identifiers: { national: null, wmo: '16000', icao },
    location: { latitude: lat, longitude: lon, elevation: 10 },
    timezone: tz,
    inventory: { hourly: end ? { start: '2000-01-01', end } : { start: null, end: null } },
  };
}

// Gialova 36.9485,21.6953. Pylos-Station ~6 km, Kalamata (LGKL) ~37 km.
const GIALOVA = { id: 'gialova', name: 'Gialova', lat: 36.9485, lon: 21.6953 };
const CATALOG_RAW = [
  raw('16726', 36.91, 21.70, { name: 'Pylos' }),
  raw('16722', 37.07, 22.03, { icao: 'LGKL', name: 'Kalamata Airport' }),
  raw('OLD01', 36.95, 21.69, { name: 'Veraltet', end: '2024-01-01' }),
  raw('NOEND', 36.949, 21.695, { name: 'Ohne Inventar', end: null }),
  { id: 'broken', name: { en: 'x' } },
];
const CATALOG = parseMeteostatCatalog(JSON.stringify(CATALOG_RAW));

// ── Katalog ─────────────────────────────────────────────────────────────────

test('parseMeteostatCatalog: Felder gemappt, kaputte Einträge verworfen', () => {
  assert.equal(CATALOG.length, 4);
  const lgkl = CATALOG.find(s => s.id === '16722');
  assert.deepEqual(lgkl, {
    id: '16722', name: 'Kalamata Airport', country: 'GR', lat: 37.07, lon: 22.03, elev: 10,
    icao: 'LGKL', wmo: '16000', tz: 'Europe/Athens', hourlyEnd: '2026-11-01',
  });
  assert.equal(CATALOG.find(s => s.id === 'NOEND').hourlyEnd, null);
});

test('loadMeteostatCatalog: Download → gunzip → Cache; frischer Cache spart Netz; stale bei Netzfehler', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mlst-'));
  const cacheFile = join(dir, 'cat.json');
  let calls = 0;
  const gz = gzipSync(Buffer.from(JSON.stringify(CATALOG_RAW)));
  const okFetch = async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length) }; };

  const a = await loadMeteostatCatalog({ fetchImpl: okFetch, cacheFile });
  assert.equal(a.length, 4);
  assert.equal(calls, 1);

  const b = await loadMeteostatCatalog({ fetchImpl: okFetch, cacheFile });
  assert.equal(calls, 1, 'frischer Cache → kein Request');
  assert.equal(b.length, 4);

  const old = (Date.now() - 30 * 86400000) / 1000;
  utimesSync(cacheFile, old, old);
  const failFetch = async () => { throw new Error('offline'); };
  const c = await loadMeteostatCatalog({ fetchImpl: failFetch, cacheFile });
  assert.equal(c.length, 4, 'stale Cache als Fallback');

  await assert.rejects(loadMeteostatCatalog({ fetchImpl: failFetch, cacheFile: join(dir, 'none.json') }));
});

// ── Spots ───────────────────────────────────────────────────────────────────

test('EXTRA_SPOTS enthält Gialova mit realen Koordinaten', () => {
  const g = EXTRA_SPOTS.find(s => /Gialova/.test(s.name));
  assert.equal(g.lat, 36.9485);
  assert.equal(g.lon, 21.6953);
  assert.equal(EXTRA_SPOTS.length, 10);
});

test('collectSpots: Dedupe auf 2 Dezimalen, spots.json hat Vorrang, u:-ID für user_locations', () => {
  const spotsJson = { regions: { gr: { spots: [{ id: 'gr_gialova', name: 'Gialova Lagune', lat: 36.9481, lon: 21.6951 }] } } };
  const spots = collectSpots({
    spotsJson,
    extraSpots: [GIALOVA, { id: 'x', name: 'Torbole', lat: 45.869, lon: 10.873 }],
    userLocations: [
      { name: 'Mein Gialova', latitude: 36.9487, longitude: 21.6952 },
      { name: 'Neu', latitude: 40.123456, longitude: 9.5 },
    ],
  });
  assert.deepEqual(spots.map(s => s.name), ['Gialova Lagune', 'Torbole', 'Neu']);
  assert.equal(spots[2].id, 'u:40.1235,9.5000');
});

// ── Stationswahl ────────────────────────────────────────────────────────────

test('rankCandidates: veraltete (>400 d) und inventarlose Stationen fliegen raus, sortiert nach km', () => {
  const r = rankCandidates(GIALOVA, CATALOG, { now: NOW });
  assert.deepEqual(r.map(s => s.id), ['16726', '16722']);
  assert.ok(r[0].km < r[1].km);
  assert.ok(r[0].km > 3 && r[0].km < 6, `Pylos km=${r[0].km}`);
});

test('pickStation: ICAO gewinnt, wenn ≤ max(preferKm, 1.5×nächste)', () => {
  const nearest = { id: 'N', lat: 0, lon: 0.09, hourlyEnd: '2026-11-01', icao: null };   // ~10 km
  const icao18  = { id: 'I', lat: 0, lon: 0.162, hourlyEnd: '2026-11-01', icao: 'abcd' }; // ~18 km
  const spot = { lat: 0, lon: 0 };
  assert.equal(pickStation(spot, [nearest, icao18], { now: NOW }).id, 'I', '18 km ≤ preferKm 20');
  assert.equal(pickStation(spot, [nearest, icao18], { now: NOW, preferKm: 5 }).id, 'N', '18 > max(5, 15)');
  assert.equal(pickStation(spot, [nearest, icao18], { now: NOW, preferKm: 5, maxKm: 15 }).id, 'N');
});

test('pickStation: Gialova → LGKL (37 km) verliert gegen Pylos (5 km), null wenn nichts ≤ maxKm', () => {
  assert.equal(pickStation(GIALOVA, CATALOG, { now: NOW }).id, '16726');
  assert.equal(pickStation({ lat: 0, lon: 0 }, CATALOG, { now: NOW }), null);
});

test('stationKeyOf: ICAO uppercase nur bei 4 Buchstaben, sonst ms:<id>', () => {
  assert.equal(stationKeyOf({ id: '16722', icao: 'lgkl' }), 'LGKL');
  assert.equal(stationKeyOf({ id: '16726', icao: null }), 'ms:16726');
  assert.equal(stationKeyOf({ id: '1', icao: 'LG1' }), 'ms:1');
});

// ── Persistenz ──────────────────────────────────────────────────────────────

test('assignStations: schreibt Stationen + Zuordnung, unassigned gelistet, live_source=metar', () => {
  const db = buildDb();
  const far = { id: 'far', name: 'Nirgendwo', lat: 0, lon: 0 };
  const kal = { id: 'kal', name: 'Kalamata Beach', lat: 37.02, lon: 22.10 };
  const res = assignStations(db, [GIALOVA, kal, far], CATALOG, { now: NOW });
  assert.deepEqual(res.unassigned, ['Nirgendwo']);
  assert.deepEqual(res.stations.map(s => s.key).sort(), ['LGKL', 'ms:16726']);

  const rows = db.prepare('SELECT station_key, live_source, tz, label FROM ml_stations ORDER BY station_key').all();
  assert.deepEqual(rows.map(r => [r.station_key, r.live_source]), [['LGKL', 'metar'], ['ms:16726', null]]);
  assert.equal(rows[1].tz, 'Europe/Athens');

  const list = listMlStations(db);
  const lgkl = list.find(s => s.key === 'LGKL');
  assert.deepEqual(lgkl.spots.map(s => s.name), ['Kalamata Beach']);
  assert.equal(lgkl.km, lgkl.spots[0].km);
  assert.equal(lgkl.enabled, true);
});

test('assignStations: Neuzuordnung verschiebt den Spot, keine Doppelzuordnung', () => {
  const db = buildDb();
  assignStations(db, [GIALOVA], CATALOG, { now: NOW });
  assert.equal(db.prepare('SELECT station_key FROM ml_station_spots WHERE spot_id=?').get('gialova').station_key, 'ms:16726');

  // Pylos geht vom Netz → beim nächsten Discover übernimmt LGKL.
  const without = CATALOG.filter(s => s.id !== '16726');
  assignStations(db, [GIALOVA], without, { now: NOW });
  const links = db.prepare('SELECT station_key FROM ml_station_spots WHERE spot_id=?').all('gialova');
  assert.deepEqual(links.map(l => l.station_key), ['LGKL']);
});

test('assignStations write:false schreibt nichts', () => {
  const db = buildDb();
  const res = assignStations(db, [GIALOVA], CATALOG, { now: NOW, write: false });
  assert.equal(res.spots.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ml_stations').get().n, 0);
});

test('findMlStationForSpot: Spot-Match ≤ 3 km, sonst nächste Station ≤ maxKm, sonst null', () => {
  const db = buildDb();
  assignStations(db, [GIALOVA], CATALOG, { now: NOW });
  db.prepare(`INSERT INTO ml_stations (station_key, label, lat, lon, tz, enabled, created_at, updated_at)
              VALUES ('LGKL','Kalamata Airport',37.07,22.03,'Europe/Athens',1,'x','x')`).run();

  const viaSpot = findMlStationForSpot(db, 36.95, 21.70);
  assert.equal(viaSpot.key, 'ms:16726');
  assert.ok(viaSpot.km > 3 && viaSpot.km < 6, 'km = Distanz Station↔Anfrage');
  assert.deepEqual(Object.keys(viaSpot).sort(), ['key', 'km', 'label', 'lat', 'lon', 'tz']);

  // Kein Spot in 3 km, aber direkt am Flughafen.
  assert.equal(findMlStationForSpot(db, 37.06, 22.02).key, 'LGKL');
  assert.equal(findMlStationForSpot(db, 45, 10), null);

  db.prepare("UPDATE ml_stations SET enabled=0 WHERE station_key='ms:16726'").run();
  assert.notEqual(findMlStationForSpot(db, 36.95, 21.70, 40)?.key, 'ms:16726', 'disabled ignoriert');
});
