// ============================================================================
// WindFoil — Schema test harness (Gialova sample data)
// File version: 1.0.0  |  App target: v2.5.0
// Runs the 001 migration on an in-memory SQLite DB via Node's built-in engine,
// seeds realistic Gialova/Navarino data, and exercises the feedback-loop queries.
//   Run:  node --experimental-sqlite db/schema.test.mjs
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const uuid = () => randomUUID();
const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Spot-local "today" (YYYY-MM-DD) — the exact rule the API uses to gate feedback.
function localDay(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // en-CA yields YYYY-MM-DD
}

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');

// --- Better Auth normally owns this; stub it for the standalone test only. ----
db.exec(`CREATE TABLE user (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, created_at TEXT
);`);

// --- Apply migration 001 ------------------------------------------------------
db.exec(readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8'));
db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)')
  .run('001_init', nowUtc());

// ============================ SEED: Gialova ==================================
const TZ = 'Europe/Athens';
const today = localDay(TZ);

const userId = uuid();
db.prepare('INSERT INTO user(id,email,name,created_at) VALUES (?,?,?,?)')
  .run(userId, 'maik@example.com', 'Maik', nowUtc());

const spotId = uuid();
db.prepare(`INSERT INTO spots(id,user_id,name,latitude,longitude,timezone,created_at)
            VALUES (?,?,?,?,?,?,?)`)
  .run(spotId, null, 'Gialova / Navarino Bay', 36.9485, 21.6953, TZ, nowUtc());

db.prepare(`INSERT INTO rider_profiles
            (user_id,weight_kg,skill_level,planing_threshold_kt,planing_threshold_source,updated_at)
            VALUES (?,?,?,?,?,?)`)
  .run(userId, 82, 'advanced', 11.0, 'manual', nowUtc());

const wingId = uuid(), foilId = uuid();
const eq = db.prepare(`INSERT INTO equipment(id,user_id,kind,name,size,is_active,created_at)
                       VALUES (?,?,?,?,?,?,?)`);
eq.run(wingId, userId, 'wing', '6.0 Wing', 6.0, 1, nowUtc());
eq.run(foilId, userId, 'foil', '1085 Front', 1085, 1, nowUtc());

// Three sessions across recent days; only TODAY's is feedback-editable.
function seedSession(dateStr, planed, planingKt, rating, matched, predScore, predWind) {
  const sid = uuid();
  db.prepare(`INSERT INTO sessions
      (id,user_id,spot_id,session_date,started_at,ended_at,wing_id,foil_id,
       planed,planing_wind_kt,rating,conditions_matched,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sid, userId, spotId, dateStr, nowUtc(), nowUtc(), wingId, foilId,
         planed, planingKt, rating, matched, 'thermik kicked in early afternoon',
         nowUtc(), nowUtc());
  db.prepare(`INSERT INTO forecast_snapshots
      (id,session_id,source,predicted_score,predicted_wind_kt,
       predicted_window_start,predicted_window_end,station_model_confidence,raw_json,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(uuid(), sid, 'foil-score', predScore, predWind,
         `${dateStr}T13:00:00Z`, `${dateStr}T17:00:00Z`, 0.82, '{}', nowUtc());
  return sid;
}
const todaySession = seedSession(today, 1, 11.5, 4, 4, 68, 12.0);
seedSession(localDay(TZ, new Date(Date.now() - 86400000)), 1, 10.5, 5, 5, 74, 13.0);
seedSession(localDay(TZ, new Date(Date.now() - 2 * 86400000)), 0, null, 2, 2, 41, 9.0);

// ============================ PROOF QUERIES ==================================
console.log('\n=== WindFoil v2.5.0 schema test — Gialova ===\n');

// 1) "Feedback only today" — what the GET endpoint returns for the editable day.
const todayFb = db.prepare(`
  SELECT s.session_date, s.planed, s.planing_wind_kt, s.rating, e1.name AS wing
  FROM sessions s LEFT JOIN equipment e1 ON e1.id = s.wing_id
  WHERE s.user_id = ? AND s.session_date = ?`).get(userId, today);
console.log('1) Today\'s editable session:', todayFb);

// 2) Feedback loop: rolling calibrated planing threshold from real lift-offs.
const calib = db.prepare(`
  SELECT ROUND(AVG(planing_wind_kt), 2) AS rolling_threshold_kt, COUNT(*) AS samples
  FROM sessions
  WHERE user_id = ? AND planed = 1 AND planing_wind_kt IS NOT NULL`).get(userId);
console.log('2) Calibrated planing threshold:', calib,
            '(profile manual override was 11.0)');

// 3) Score-drift: predicted Foil-Score / wind vs. the rider's actual outcome.
const drift = db.prepare(`
  SELECT s.session_date, fs.predicted_score, fs.predicted_wind_kt,
         s.planing_wind_kt AS actual_liftoff_kt, s.rating,
         ROUND(fs.predicted_wind_kt - s.planing_wind_kt, 2) AS wind_error_kt
  FROM sessions s JOIN forecast_snapshots fs ON fs.session_id = s.id
  WHERE s.user_id = ? AND fs.source = 'foil-score'
  ORDER BY s.session_date DESC`).all(userId);
console.log('3) Score-drift (model vs. reality):');
console.table(drift);

// 4) Entitlement gate (dormant) — premium feature must read as locked.
const ent = db.prepare(`
  SELECT 1 FROM entitlements
  WHERE user_id = ? AND feature_key = ? AND status = 'active'
    AND (expires_at IS NULL OR expires_at > ?)`)
  .get(userId, 'extended_forecast', nowUtc());
console.log('4) Premium "extended_forecast" unlocked?', ent ? 'YES' : 'NO (locked, as expected)');

// 5) Integrity: FK + CHECK enforcement actually works.
let rejected = false;
try {
  db.prepare(`INSERT INTO sessions(id,user_id,spot_id,session_date,rating,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(uuid(), userId, spotId, today, 9 /* invalid rating */, nowUtc(), nowUtc());
} catch { rejected = true; }
console.log('5) CHECK rejects rating=9?', rejected ? 'YES (constraint works)' : 'NO — problem!');

console.log('\n=== all checks executed ===\n');
db.close();
