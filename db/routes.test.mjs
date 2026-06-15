// ============================================================================
// WindFoil — Route-logic test harness (the SQL behind the new endpoints)
// File version: 1.0.0  |  App target: v2.5.0
//   Run:  node --experimental-sqlite db/routes.test.mjs
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';

const nowUtc = () => new Date().toISOString();
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at TEXT);`);
db.exec(readFileSync(new URL('./migrations/001_init.sql', import.meta.url), 'utf8'));

const uid = uuid();
db.prepare('INSERT INTO user VALUES (?,?,?,?)').run(uid, 'maik@example.com', 'Maik', nowUtc());
const spotId = uuid();
db.prepare(`INSERT INTO spots VALUES (?,?,?,?,?,?,?)`)
  .run(spotId, null, 'Gialova / Navarino Bay', 36.9485, 21.6953, 'Europe/Athens', nowUtc());

let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

console.log('\n=== v2.5.0 route-logic tests ===\n');

// --- profile: PATCH /threshold upsert (insert then update) ---
const upTh = db.prepare(`INSERT INTO rider_profiles
  (user_id,planing_threshold_kt,planing_threshold_source,updated_at) VALUES (?,?,?,?)
  ON CONFLICT(user_id) DO UPDATE SET planing_threshold_kt=excluded.planing_threshold_kt,
    planing_threshold_source=excluded.planing_threshold_source, updated_at=excluded.updated_at`);
upTh.run(uid, 11.0, 'manual', nowUtc());
upTh.run(uid, 11.2, 'calibrated', nowUtc()); // simulate "Use 11.2 kt"
const prof = db.prepare('SELECT * FROM rider_profiles WHERE user_id=?').get(uid);
ok('threshold upsert updates in place', prof.planing_threshold_kt === 11.2 && prof.planing_threshold_source === 'calibrated');

// --- equipment: POST then PATCH toggle then DELETE ---
const eqId = uuid();
db.prepare(`INSERT INTO equipment (id,user_id,kind,name,size,is_active,created_at)
            VALUES (?,?,?,?,?,1,?)`).run(eqId, uid, 'wing', '6.0 Wing', 6.0, nowUtc());
db.prepare(`UPDATE equipment SET is_active=COALESCE(?,is_active) WHERE id=? AND user_id=?`)
  .run(0, eqId, uid);
ok('equipment toggle is_active', db.prepare('SELECT is_active FROM equipment WHERE id=?').get(eqId).is_active === 0);
const foilId = uuid();
db.prepare(`INSERT INTO equipment (id,user_id,kind,name,size,is_active,created_at)
            VALUES (?,?,?,?,?,1,?)`).run(foilId, uid, 'foil', '1085 Front', 1085, nowUtc());
const list = db.prepare('SELECT * FROM equipment WHERE user_id=? ORDER BY is_active DESC, kind').all(uid);
ok('equipment list returns both, active first', list.length === 2 && list[0].kind === 'foil');
db.prepare('DELETE FROM equipment WHERE id=? AND user_id=?').run(eqId, uid);
ok('equipment delete removes row', db.prepare('SELECT COUNT(*) c FROM equipment WHERE user_id=?').get(uid).c === 1);

// --- session referencing now-deleted wing keeps existing (FK SET NULL) ---
const sid = uuid();
db.prepare(`INSERT INTO sessions
  (id,user_id,spot_id,session_date,foil_id,planed,planing_wind_kt,rating,conditions_matched,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run(sid, uid, spotId, '2026-06-14', foilId, 1, 11.5, 4, 4, nowUtc(), nowUtc());
db.prepare(`INSERT INTO forecast_snapshots
  (id,session_id,source,predicted_score,predicted_wind_kt,station_model_confidence,raw_json,captured_at)
  VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), sid, 'foil-score', 68, 12.0, 0.82, '{}', nowUtc());
db.prepare('DELETE FROM equipment WHERE id=?').run(foilId);
ok('session survives equipment delete (FK SET NULL)',
   db.prepare('SELECT foil_id FROM sessions WHERE id=?').get(sid).foil_id === null);

// --- analytics: drift query + MAE ---
const drift = db.prepare(`
  SELECT s.session_date, fs.predicted_wind_kt, s.planing_wind_kt AS actual_liftoff_kt,
         ROUND(fs.predicted_wind_kt - s.planing_wind_kt,2) AS wind_error_kt
  FROM sessions s JOIN forecast_snapshots fs ON fs.session_id=s.id AND fs.source='foil-score'
  WHERE s.user_id=? AND s.spot_id=? ORDER BY s.session_date ASC`).all(uid, spotId);
ok('drift query returns the session', drift.length === 1 && drift[0].wind_error_kt === 0.5);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
db.close();
process.exit(fail ? 1 : 0);
