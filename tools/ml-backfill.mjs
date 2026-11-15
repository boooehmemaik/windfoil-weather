#!/usr/bin/env node
// ============================================================================
// WindFoil — CLI: ML-Stationen entdecken + historischen Backfill fahren
// File version: 1.0.0  |  App target: v3.42.0
// ----------------------------------------------------------------------------
// node tools/ml-backfill.mjs [--discover] [--months N] [--station KEY] [--train] [--dry-run]
// DB: WINDFOIL_DB_PATH (Default data/windfoil.db). Nach 429 einfach erneut starten.
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTRA_SPOTS, loadMeteostatCatalog, collectSpots, assignStations, listMlStations,
} from '../src/ml_stations.mjs';
import { runBackfill, pendingChunks, yesterdayUtc } from '../src/ml_backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_CACHE = join(ROOT, 'data', 'meteostat-stations-ml.json');

function parseArgs(argv) {
  const args = { discover: false, months: 24, station: null, train: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--discover') args.discover = true;
    else if (a === '--train') args.train = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--months') args.months = Math.max(1, parseInt(argv[++i], 10) || 24);
    else if (a === '--station') args.station = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unbekanntes Argument: ${a}`);
  }
  return args;
}

// db.mjs öffnet die DB beim Import — deshalb dynamisch, damit --help ohne DB läuft.
async function openDb() {
  const mod = await import('../src/db.mjs');
  try { mod.runMigrations(); }
  catch (e) { console.warn(`[ml-backfill] Migrationen nicht ausgeführt (${e.message}) — 013 manuell anwenden.`); }
  return mod;
}

function readUserLocations(db) {
  try { return db.prepare('SELECT DISTINCT name, latitude, longitude FROM user_locations').all(); }
  catch { return []; }
}

function printAssignment(res) {
  console.log('\nSpot'.padEnd(30) + 'Station'.padEnd(36) + 'km');
  for (const s of res.spots) {
    console.log(String(s.spotName).slice(0, 28).padEnd(29) + `${s.stationKey} ${s.label}`.slice(0, 34).padEnd(36) + s.km);
  }
  if (res.unassigned.length) console.log(`\nOhne Station (≤ 40 km): ${res.unassigned.join(', ')}`);
  console.log(`\n${res.stations.length} Stationen für ${res.spots.length} Spots.`);
}

async function discover(db, { dryRun }) {
  const catalog = await loadMeteostatCatalog({ cacheFile: CATALOG_CACHE });
  const spotsJson = JSON.parse(readFileSync(join(ROOT, 'spots.json'), 'utf8'));
  const spots = collectSpots({ spotsJson, extraSpots: EXTRA_SPOTS, userLocations: readUserLocations(db) });
  const res = assignStations(db, spots, catalog, { write: !dryRun });
  printAssignment(res);
  return res;
}

function printPlan(db, stations, months) {
  const endDay = yesterdayUtc();
  for (const st of stations) {
    const todo = pendingChunks(db, st.key, { months, endDay });
    console.log(`${st.key.padEnd(14)} ${String(st.label).slice(0, 30).padEnd(31)} offen: ${todo.length}/${months} Monate`);
  }
}

// Erst der lineare (History-)MOS — ohne station_mos_bias antwortet
// /api/station/mos mit no_mos_data und das Netz käme nie im Frontend an.
async function train(db, stations) {
  const { runMosJob, markObsEpoch, getObsEpoch } = await import('../src/mos.mjs');
  const { trainNeuralMos } = await import('../src/neural_mos.mjs');
  if (!getObsEpoch(db)) markObsEpoch(db, new Date().toISOString());
  const mos = await runMosJob(db, stations.map(s => ({ key: s.key, lat: s.lat, lon: s.lon, tz: s.tz })));
  for (const r of mos.results || []) {
    console.log(`[mos] ${r.station}: ${r.ok ? `${r.source} · ${r.usableHours}/24 h nutzbar · n≤${r.maxN}` : r.error}`);
  }
  for (const st of stations) {
    const r = trainNeuralMos(db, st.key);
    const e = r.eval || {};
    console.log(`[neural] ${st.key}: ${r.ok
      ? `n=${r.n} skill=${e.skill ?? '–'} MAE roh/netz/linear=${e.maeRaw ?? '–'}/${e.maeModel ?? '–'}/${e.maeLinear ?? '–'} · situativ=${r.activeFc} tabelle=${r.active}`
      : r.reason}`);
    await new Promise(res => setImmediate(res));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')[5]); return; }

  const { db, closeDb } = await openDb();
  try {
    if (args.discover) await discover(db, args);
    let stations = listMlStations(db).filter(s => s.enabled);
    if (args.station) stations = stations.filter(s => s.key === args.station);
    if (!stations.length) { console.log('Keine ml_stations — zuerst --discover.'); return; }

    if (args.dryRun) { printPlan(db, stations, args.months); return; }

    const res = await runBackfill(db, stations, {
      months: args.months,
      log: msg => console.log(msg),
      onProgress: p => {
        if (p.rateLimited) console.log(`[${p.done}/${p.total}] ${p.station} STOPP (${p.reason === 'budget' ? 'eigenes Tagesbudget' : 'Open-Meteo 429'})`);
        else if (p.result) console.log(`[${p.done}/${p.total}] ${p.station} +${p.result.rows} Zeilen${p.result.error ? ` · ${p.result.error}` : ''}`);
      },
    });
    if (res.rateLimited) console.log(`\nGestoppt bei ${res.stoppedAt} (${res.reason}) — morgen erneut starten, Fortschritt ist gespeichert.`);
    else console.log(`\nFertig: ${res.rows} Zeilen.`);
    console.log(`Open-Meteo-Budget heute: ${Math.round(res.budgetUsed ?? 0)} Calls verbraucht.`);

    if (args.train) await train(db, stations);
  } finally {
    closeDb();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
