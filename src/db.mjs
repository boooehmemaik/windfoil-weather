// ============================================================================
// WindFoil — Database layer (better-sqlite3)
// File version: 1.0.1 (ESM .mjs)  |  App target: v3.3.5
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

// Feedback loop: recompute the rolling planing threshold from real lift-offs.
// Respects user authority — if they set it manually, we DON'T overwrite; we
// only return the suggestion so the UI can offer "update to <x> kt?".
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
