// ============================================================================
// WindFoil — Database layer (better-sqlite3)
// File version: 1.1.0 (ESM .mjs)  |  App target: v3.11.0
// ----------------------------------------------------------------------------
// Production note: requires `npm i better-sqlite3`. (The test harness uses the
// experimental built-in node:sqlite instead; this file is the real runtime.)
// ============================================================================
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

// DB path comes from env (keep it next to windfoil.env on the LXC), default local.
const DB_PATH = process.env.WINDFOIL_DB_PATH || join(__dirname, '..', 'data', 'windfoil.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // better concurrent reads for the dashboard
db.pragma('foreign_keys = ON');    // must be set per connection in SQLite

// --- Migration runner ---------------------------------------------------------
// Applies any *.sql in db/migrations not yet recorded in schema_migrations,
// in filename order, each inside its own transaction.
export function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
             version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)')
        .run(version, new Date().toISOString());
    });
    tx();
    console.log(`[migrate] applied ${version}`);
  }
}

// --- Shared helpers -----------------------------------------------------------

// Spot-local calendar day 'YYYY-MM-DD' — single source of truth for the
// "feedback only today" rule. Same logic as the tested harness.
export function localDay(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// Entitlement gate — the ONLY place premium features should be checked.
// Returns true while dormant only if a matching active row exists (it won't,
// until the payment webhook starts writing rows). Server-side, never trust FE.
export function hasEntitlement(userId, featureKey) {
  const row = db.prepare(`
    SELECT 1 FROM entitlements
    WHERE user_id = ? AND feature_key = ? AND status = 'active'
      AND (expires_at IS NULL OR expires_at > ?)`)
    .get(userId, featureKey, new Date().toISOString());
  return !!row;
}

// DEPRECATED for the feedback loop: this aggregated ALL of a rider's sessions
// across EVERY spot into one global threshold, so a gusty spot skewed the score
// everywhere. The loop now calibrates per spot (see recalibrateSpotPlaningThreshold).
// Kept only for any out-of-band/global use; the feedback route no longer calls it.
export function recalibratePlaningThreshold(userId) {
  const agg = db.prepare(`
    SELECT AVG(planing_wind_kt) AS rolling, COUNT(*) AS samples
    FROM sessions
    WHERE user_id = ? AND planed = 1 AND planing_wind_kt IS NOT NULL`).get(userId);
  if (!agg.samples) return { rolling: null, samples: 0, applied: false };

  const rolling = Math.round(agg.rolling * 10) / 10;
  const profile = db.prepare(
    'SELECT planing_threshold_source FROM rider_profiles WHERE user_id = ?').get(userId);

  const applied = !profile || profile.planing_threshold_source !== 'manual';
  if (applied) {
    db.prepare(`UPDATE rider_profiles
                SET planing_threshold_kt = ?, planing_threshold_source = 'calibrated',
                    updated_at = ?
                WHERE user_id = ?`).run(rolling, new Date().toISOString(), userId);
  }
  return { rolling, samples: agg.samples, applied };
}

// Per-spot feedback loop: recompute the rolling planing threshold from the
// rider's real lift-offs AT THIS SPOT ONLY, and persist it per (user, spot).
// This deliberately does NOT touch rider_profiles, so local feedback shapes the
// local score without changing the rider's settings everywhere.
export function recalibrateSpotPlaningThreshold(userId, spotId) {
  const agg = db.prepare(`
    SELECT AVG(planing_wind_kt) AS rolling, COUNT(*) AS samples
    FROM sessions
    WHERE user_id = ? AND spot_id = ? AND planed = 1 AND planing_wind_kt IS NOT NULL`)
    .get(userId, spotId);
  if (!agg.samples) return { spotId, rolling: null, samples: 0, scope: 'spot' };

  const rolling = Math.round(agg.rolling * 10) / 10;
  db.prepare(`INSERT INTO spot_calibration
                (user_id, spot_id, planing_threshold_kt, samples, updated_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(user_id, spot_id) DO UPDATE SET
                planing_threshold_kt = excluded.planing_threshold_kt,
                samples              = excluded.samples,
                updated_at           = excluded.updated_at`)
    .run(userId, spotId, rolling, agg.samples, new Date().toISOString());
  return { spotId, rolling, samples: agg.samples, scope: 'spot' };
}

// Effective per-spot calibrated threshold (knots) from feedback, or null if the
// rider has no planed sessions logged at this spot yet.
export function getSpotCalibration(userId, spotId) {
  const row = db.prepare(`
    SELECT planing_threshold_kt AS rolling, samples
    FROM spot_calibration WHERE user_id = ? AND spot_id = ?`).get(userId, spotId);
  return row
    ? { spotId, rolling: row.rolling, samples: row.samples, scope: 'spot' }
    : { spotId, rolling: null, samples: 0, scope: 'spot' };
}

// Rolling per (user, spot, wing_m2) aus sessions neu berechnen.
export function recalibrateSpotWingRange(userId, spotId) {
  const rows = db.prepare(`
    SELECT wing_m2,
           AVG(range_low_kt)  AS lo,
           AVG(range_high_kt) AS hi,
           COUNT(*)           AS samples
    FROM sessions
    WHERE user_id=? AND spot_id=? AND wing_m2 IS NOT NULL
      AND (range_low_kt IS NOT NULL OR range_high_kt IS NOT NULL)
    GROUP BY wing_m2`).all(userId, spotId);
  const up = db.prepare(`INSERT INTO spot_wing_calibration
      (user_id,spot_id,wing_m2,range_low_kt,range_high_kt,samples,updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,spot_id,wing_m2) DO UPDATE SET
        range_low_kt=excluded.range_low_kt, range_high_kt=excluded.range_high_kt,
        samples=excluded.samples, updated_at=excluded.updated_at`);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of rows)
      up.run(userId, spotId, r.wing_m2,
             r.lo==null?null:Math.round(r.lo*10)/10,
             r.hi==null?null:Math.round(r.hi*10)/10, r.samples, now);
  });
  tx();
  return getSpotWingCalibration(userId, spotId);
}

// Alle Wing-Ranges eines Spots als Array [{wingM2,minKn,maxKn,samples}].
export function getSpotWingCalibration(userId, spotId) {
  return db.prepare(`
    SELECT wing_m2 AS wingM2, range_low_kt AS minKn, range_high_kt AS maxKn, samples
    FROM spot_wing_calibration WHERE user_id=? AND spot_id=?`).all(userId, spotId);
}
