/**
 * feedback-wing-range.test.mjs
 * Phase 5 Tests — Backend-Recalc Wing-Range-Kalibrierung (DESIGN §6b)
 *
 * Ansatz: better-sqlite3 :memory:, Migrations 001/002/005 laden,
 * minimal user+spot seeden, sessions INSERT, dann recalibrateSpotWingRange
 * und getSpotWingCalibration asserten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = (f) => readFileSync(join(__dirname, 'db', 'migrations', f), 'utf8');

// ── Setup helpers ─────────────────────────────────────────────────────────────

function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Better Auth owns the `user` table; stub it for tests.
  db.exec(`CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT
  )`);

  // Apply the migrations needed for this test
  db.exec(MIG('001_init.sql'));
  db.exec(MIG('002_spot_calibration.sql'));
  db.exec(MIG('005_spot_wing_calibration.sql'));

  return db;
}

function seedUserAndSpot(db) {
  const userId = 'test-user-1';
  const spotId = 'test-spot-1';

  db.prepare(`INSERT INTO user (id, name, email) VALUES (?, ?, ?)`)
    .run(userId, 'Test User', 'test@example.com');

  db.prepare(`INSERT INTO spots (id, user_id, name, latitude, longitude, timezone, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(spotId, userId, 'Talamone', 42.55, 11.13, 'Europe/Rome', new Date().toISOString());

  return { userId, spotId };
}

function insertSession(db, { userId, spotId, wingM2, rangeLowKt, rangeHighKt, suffix = '' }) {
  const id = `session-${suffix || Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sessions
    (id, user_id, spot_id, session_date, wing_m2, range_low_kt, range_high_kt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, spotId, '2026-08-02', wingM2 ?? null, rangeLowKt ?? null, rangeHighKt ?? null, now, now);
  return id;
}

// ── Inline implementations (mirror db.mjs functions against the test db) ──────
// We wire functions against our in-memory db instance, mirroring db.mjs §2 exactly.

function makeDbFunctions(db) {
  function getSpotWingCalibration(userId, spotId) {
    return db.prepare(`
      SELECT wing_m2 AS wingM2, range_low_kt AS minKn, range_high_kt AS maxKn, samples
      FROM spot_wing_calibration WHERE user_id=? AND spot_id=?`).all(userId, spotId);
  }

  function recalibrateSpotWingRange(userId, spotId) {
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
               r.lo == null ? null : Math.round(r.lo * 10) / 10,
               r.hi == null ? null : Math.round(r.hi * 10) / 10,
               r.samples, now);
    });
    tx();
    return getSpotWingCalibration(userId, spotId);
  }

  return { recalibrateSpotWingRange, getSpotWingCalibration };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — 2 Sessions gleiche Wing-Größe: gemittelter Range
// ─────────────────────────────────────────────────────────────────────────────
test('6b-1 — 2 Sessions 4m²: AVG range_low/high korrekt', () => {
  const db = buildDb();
  const { userId, spotId } = seedUserAndSpot(db);
  const { recalibrateSpotWingRange, getSpotWingCalibration } = makeDbFunctions(db);

  insertSession(db, { userId, spotId, wingM2: 4, rangeLowKt: 20, rangeHighKt: 28, suffix: 'a' });
  insertSession(db, { userId, spotId, wingM2: 4, rangeLowKt: 24, rangeHighKt: 32, suffix: 'b' });

  const result = recalibrateSpotWingRange(userId, spotId);
  assert.equal(result.length, 1, 'Genau ein Eintrag für 4m² erwartet');

  const entry = result[0];
  assert.equal(entry.wingM2, 4);
  assert.equal(entry.samples, 2);
  // AVG(20,24)=22, AVG(28,32)=30
  assert.equal(entry.minKn, 22.0, `minKn erwartet 22, got ${entry.minKn}`);
  assert.equal(entry.maxKn, 30.0, `maxKn erwartet 30, got ${entry.maxKn}`);

  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Mehrere Wing-Größen: je eigene Kalibrierung
// ─────────────────────────────────────────────────────────────────────────────
test('6b-2 — Sessions mit 4m² und 5m²: separate Einträge', () => {
  const db = buildDb();
  const { userId, spotId } = seedUserAndSpot(db);
  const { recalibrateSpotWingRange, getSpotWingCalibration } = makeDbFunctions(db);

  insertSession(db, { userId, spotId, wingM2: 4, rangeLowKt: 18, rangeHighKt: 26, suffix: 'c' });
  insertSession(db, { userId, spotId, wingM2: 5, rangeLowKt: 14, rangeHighKt: 22, suffix: 'd' });
  insertSession(db, { userId, spotId, wingM2: 5, rangeLowKt: 16, rangeHighKt: 24, suffix: 'e' });

  const result = recalibrateSpotWingRange(userId, spotId);
  assert.equal(result.length, 2, 'Zwei Einträge (4m² und 5m²) erwartet');

  const e4 = result.find(r => r.wingM2 === 4);
  const e5 = result.find(r => r.wingM2 === 5);
  assert(e4, '4m²-Eintrag erwartet');
  assert(e5, '5m²-Eintrag erwartet');

  assert.equal(e4.samples, 1);
  assert.equal(e4.minKn, 18.0);
  assert.equal(e4.maxKn, 26.0);

  assert.equal(e5.samples, 2);
  // AVG(14,16)=15, AVG(22,24)=23
  assert.equal(e5.minKn, 15.0);
  assert.equal(e5.maxKn, 23.0);

  // Verify getSpotWingCalibration returns same data
  const cal = getSpotWingCalibration(userId, spotId);
  assert.equal(cal.length, 2);

  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Grenzfall: nur range_low_kt gesetzt, kein high
// ─────────────────────────────────────────────────────────────────────────────
test('6b-3 — Nur range_low_kt: Eintrag mit maxKn=null', () => {
  const db = buildDb();
  const { userId, spotId } = seedUserAndSpot(db);
  const { recalibrateSpotWingRange } = makeDbFunctions(db);

  insertSession(db, { userId, spotId, wingM2: 4, rangeLowKt: 22, rangeHighKt: null, suffix: 'f' });

  const result = recalibrateSpotWingRange(userId, spotId);
  assert.equal(result.length, 1, 'Ein Eintrag erwartet (Zeile hat range_low gesetzt)');
  const entry = result[0];
  assert.equal(entry.minKn, 22.0, `minKn erwartet 22, got ${entry.minKn}`);
  assert.equal(entry.maxKn, null, `maxKn muss null sein wenn high nicht gesetzt`);

  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Grenzfall: nur range_high_kt gesetzt, kein low
// ─────────────────────────────────────────────────────────────────────────────
test('6b-4 — Nur range_high_kt: Eintrag mit minKn=null', () => {
  const db = buildDb();
  const { userId, spotId } = seedUserAndSpot(db);
  const { recalibrateSpotWingRange } = makeDbFunctions(db);

  insertSession(db, { userId, spotId, wingM2: 5, rangeLowKt: null, rangeHighKt: 28, suffix: 'g' });

  const result = recalibrateSpotWingRange(userId, spotId);
  assert.equal(result.length, 1, 'Ein Eintrag erwartet (Zeile hat range_high gesetzt)');
  const entry = result[0];
  assert.equal(entry.minKn, null, `minKn muss null sein wenn low nicht gesetzt`);
  assert.equal(entry.maxKn, 28.0, `maxKn erwartet 28, got ${entry.maxKn}`);

  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Session ohne wing_m2: wird nicht gezählt
// ─────────────────────────────────────────────────────────────────────────────
test('6b-5 — Session ohne wing_m2: kein Kalibrierungs-Eintrag', () => {
  const db = buildDb();
  const { userId, spotId } = seedUserAndSpot(db);
  const { recalibrateSpotWingRange } = makeDbFunctions(db);

  // Kein wingM2 → soll ignoriert werden
  insertSession(db, { userId, spotId, wingM2: null, rangeLowKt: 20, rangeHighKt: 28, suffix: 'h' });

  const result = recalibrateSpotWingRange(userId, spotId);
  assert.equal(result.length, 0, 'Kein Eintrag erwartet wenn wing_m2 null');

  db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Upsert: zweiter recalibrate-Aufruf aktualisiert bestehenden Eintrag
// ─────────────────────────────────────────────────────────────────────────────
test('6b-6 — Upsert: zweiter Recalibrate-Aufruf aktualisiert Samples', () => {
  const db = buildDb();
  const { userId, spotId } = seedUserAndSpot(db);
  const { recalibrateSpotWingRange, getSpotWingCalibration } = makeDbFunctions(db);

  insertSession(db, { userId, spotId, wingM2: 4, rangeLowKt: 20, rangeHighKt: 28, suffix: 'i' });
  const r1 = recalibrateSpotWingRange(userId, spotId);
  assert.equal(r1[0].samples, 1, 'Nach erster Session: 1 Sample');

  insertSession(db, { userId, spotId, wingM2: 4, rangeLowKt: 24, rangeHighKt: 32, suffix: 'j' });
  const r2 = recalibrateSpotWingRange(userId, spotId);
  assert.equal(r2[0].samples, 2, 'Nach zweiter Session: 2 Samples (Upsert korrekt)');
  assert.equal(r2[0].minKn, 22.0, 'AVG(20,24)=22 nach Upsert');
  assert.equal(r2[0].maxKn, 30.0, 'AVG(28,32)=30 nach Upsert');

  // getSpotWingCalibration muss konsistent sein
  const cal = getSpotWingCalibration(userId, spotId);
  assert.equal(cal[0].samples, 2);

  db.close();
});
