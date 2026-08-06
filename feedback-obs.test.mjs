/**
 * feedback-obs.test.mjs
 * Phase 5 Tests — Obs-basiertes Feedback (DESIGN §7)
 *
 * Ansatz: better-sqlite3 :memory:, Migrations 001–006 laden,
 * minimal user+spot seeden, dann getObservedWindRange + Feedback-Kernlogik
 * + Poller-Idempotenz asserten.
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

  // Migrations 001–006
  db.exec(MIG('001_init.sql'));
  db.exec(MIG('002_spot_calibration.sql'));
  db.exec(MIG('003_user_locations.sql'));
  db.exec(MIG('004_user_prefs.sql'));
  db.exec(MIG('005_spot_wing_calibration.sql'));
  db.exec(MIG('006_station_obs.sql'));

  return db;
}

function seedUserAndSpot(db) {
  const userId = 'test-user-obs';
  const spotId = 'test-spot-obs';

  db.prepare(`INSERT INTO user (id, name, email) VALUES (?, ?, ?)`)
    .run(userId, 'Obs User', 'obs@test.com');

  db.prepare(`INSERT INTO spots (id, user_id, name, latitude, longitude, timezone, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(spotId, userId, 'Talamone', 42.554, 11.128, 'Europe/Rome', new Date().toISOString());

  return { userId, spotId };
}

// ── Inline implementations (mirror db.mjs functions against the test db) ──────

function makeDbFunctions(db) {
  function getObservedWindRange(stationKey, startIso, endIso) {
    const rows = db.prepare(`SELECT wind_ms, gust_ms FROM station_obs
       WHERE station_key=? AND ts>=? AND ts<=?`).all(stationKey, startIso, endIso);
    if (!rows.length) return null;
    const winds = rows.map(r => r.wind_ms).filter(v => v != null);
    const gusts = rows.map(r => r.gust_ms).filter(v => v != null);
    if (!winds.length) return null;
    const KN = 1.94384;
    return {
      lowKn:   Math.round(Math.min(...winds) * KN * 10) / 10,
      highKn:  Math.round(Math.max(...(gusts.length ? gusts : winds)) * KN * 10) / 10,
      samples: rows.length,
    };
  }

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

  return { getObservedWindRange, recalibrateSpotWingRange, getSpotWingCalibration };
}

// ── Helper: obs einfügen ──────────────────────────────────────────────────────

function insertObs(db, { stationKey, ts, wind_ms, gust_ms, lat = 42.554, lon = 11.128 }) {
  db.prepare(`INSERT OR IGNORE INTO station_obs (station_key, ts, wind_ms, gust_ms, lat, lon)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(stationKey, ts, wind_ms ?? null, gust_ms ?? null, lat, lon);
}

// ── Test 1: getObservedWindRange — low=min(wind), high=max(gust), samples=n ──

test('obs-1 — getObservedWindRange: low=min(wind_ms), high=max(gust_ms), samples korrekt', () => {
  const db = buildDb();
  const { getObservedWindRange } = makeDbFunctions(db);

  const start = '2026-08-06T10:00:00.000Z';
  const end   = '2026-08-06T14:00:00.000Z';

  // 3 Messungen im Fenster mit variierendem wind/gust
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T10:30:00.000Z', wind_ms: 5.0, gust_ms: 7.5 });
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T11:30:00.000Z', wind_ms: 7.0, gust_ms: 10.0 });
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T12:30:00.000Z', wind_ms: 6.0, gust_ms: 9.0 });

  const result = getObservedWindRange('talamone', start, end);
  assert(result !== null, 'Ergebnis darf nicht null sein');
  assert.equal(result.samples, 3, `samples=3 erwartet, got ${result.samples}`);

  const KN = 1.94384;
  const expectedLow  = Math.round(5.0 * KN * 10) / 10; // min wind = 5.0 m/s
  const expectedHigh = Math.round(10.0 * KN * 10) / 10; // max gust = 10.0 m/s
  assert.equal(result.lowKn, expectedLow,  `lowKn=${expectedLow} erwartet, got ${result.lowKn}`);
  assert.equal(result.highKn, expectedHigh, `highKn=${expectedHigh} erwartet, got ${result.highKn}`);

  db.close();
});

// ── Test 2: Grenzfall — kein Obs → null ──────────────────────────────────────

test('obs-2 — getObservedWindRange: kein Obs → null', () => {
  const db = buildDb();
  const { getObservedWindRange } = makeDbFunctions(db);

  const result = getObservedWindRange('talamone', '2026-08-06T10:00:00.000Z', '2026-08-06T14:00:00.000Z');
  assert.strictEqual(result, null, 'Kein Obs → null erwartet');

  db.close();
});

// ── Test 3: Grenzfall — nur wind (kein gust) → high aus wind ─────────────────

test('obs-3 — getObservedWindRange: nur wind_ms (kein gust) → highKn aus wind', () => {
  const db = buildDb();
  const { getObservedWindRange } = makeDbFunctions(db);

  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T11:00:00.000Z', wind_ms: 6.0, gust_ms: null });
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T12:00:00.000Z', wind_ms: 8.0, gust_ms: null });

  const result = getObservedWindRange('talamone', '2026-08-06T10:00:00.000Z', '2026-08-06T14:00:00.000Z');
  assert(result !== null, 'Ergebnis darf nicht null sein');

  const KN = 1.94384;
  const expectedLow  = Math.round(6.0 * KN * 10) / 10; // min wind
  const expectedHigh = Math.round(8.0 * KN * 10) / 10; // max wind (kein gust)
  assert.equal(result.lowKn, expectedLow,   `lowKn=${expectedLow} erwartet`);
  assert.equal(result.highKn, expectedHigh, `highKn=${expectedHigh} erwartet (kein gust → aus wind)`);
  assert.equal(result.samples, 2);

  db.close();
});

// ── Test 4: Obs außerhalb des Fensters werden ignoriert ───────────────────────

test('obs-4 — getObservedWindRange: Obs außerhalb des Fensters ignoriert', () => {
  const db = buildDb();
  const { getObservedWindRange } = makeDbFunctions(db);

  // Obs im Fenster
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T12:00:00.000Z', wind_ms: 5.0, gust_ms: 8.0 });
  // Obs außerhalb
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T08:00:00.000Z', wind_ms: 20.0, gust_ms: 30.0 });
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T20:00:00.000Z', wind_ms: 20.0, gust_ms: 30.0 });

  const result = getObservedWindRange('talamone', '2026-08-06T10:00:00.000Z', '2026-08-06T14:00:00.000Z');
  assert(result !== null);
  assert.equal(result.samples, 1, 'Nur 1 Obs im Fenster erwartet');

  const KN = 1.94384;
  assert.equal(result.lowKn,  Math.round(5.0 * KN * 10) / 10);
  assert.equal(result.highKn, Math.round(8.0 * KN * 10) / 10);

  db.close();
});

// ── Test 5: Feedback-Kernlogik — abgeleitete Range → sessions → recalibrate ──

test('obs-5 — Feedback-Kernlogik: abgeleitete Range aus Obs → sessions → recalibrateSpotWingRange', () => {
  const db = buildDb();
  const { getObservedWindRange, recalibrateSpotWingRange } = makeDbFunctions(db);
  const { userId, spotId } = seedUserAndSpot(db);

  // Obs seeden (im Session-Zeitfenster)
  const start = '2026-08-06T10:00:00.000Z';
  const end   = '2026-08-06T13:00:00.000Z';
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T10:30:00.000Z', wind_ms: 5.0, gust_ms: 9.0 });
  insertObs(db, { stationKey: 'talamone', ts: '2026-08-06T11:30:00.000Z', wind_ms: 6.0, gust_ms: 11.0 });

  // Obs → Range ableiten (wie feedback.routes.mjs es tut)
  const obs = getObservedWindRange('talamone', start, end);
  assert(obs !== null, 'Obs müssen vorhanden sein');
  const rangeLowKt  = obs.lowKn;
  const rangeHighKt = obs.highKn;

  // Session einfügen (wie der POST-Handler es tut)
  const sessionId = 'test-session-obs-1';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sessions
    (id, user_id, spot_id, session_date, wing_m2, range_low_kt, range_high_kt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, userId, spotId, '2026-08-06', 4.0, rangeLowKt, rangeHighKt, now, now);

  // Kalibrierung
  const cal = recalibrateSpotWingRange(userId, spotId);
  assert.equal(cal.length, 1, '1 Wing-Eintrag erwartet');
  const entry = cal[0];
  assert.equal(entry.wingM2, 4.0);
  assert.equal(entry.minKn, rangeLowKt,  `minKn=${rangeLowKt} erwartet`);
  assert.equal(entry.maxKn, rangeHighKt, `maxKn=${rangeHighKt} erwartet`);
  assert.equal(entry.samples, 1);

  db.close();
});

// ── Test 6: Kein-Obs-Fall → observed:false, kein Crash, keine Kalibrierung ───

test('obs-6 — Kein-Obs-Fall: observed=false, kein Crash, keine Kalibrierung', () => {
  const db = buildDb();
  const { getObservedWindRange, recalibrateSpotWingRange, getSpotWingCalibration } = makeDbFunctions(db);
  const { userId, spotId } = seedUserAndSpot(db);

  // Keine Obs vorhanden
  const obs = getObservedWindRange('talamone', '2026-08-06T10:00:00.000Z', '2026-08-06T13:00:00.000Z');
  const observed = obs !== null;
  assert.strictEqual(observed, false, 'observed muss false sein wenn keine Obs');

  // Session OHNE Range-Felder speichern (wie der Handler es bei observed=false tut)
  const sessionId = 'test-session-no-obs';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sessions
    (id, user_id, spot_id, session_date, wing_m2, range_low_kt, range_high_kt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, userId, spotId, '2026-08-06', 4.0, null, null, now, now);

  // Kalibrierung: kein Crash, kein Eintrag (range-Felder null → WHERE-Filter schlägt fehl)
  const cal = recalibrateSpotWingRange(userId, spotId);
  assert.equal(cal.length, 0, 'Keine Kalibrierung ohne Range-Daten erwartet');

  db.close();
});

// ── Test 7: Poller — INSERT OR IGNORE Idempotenz ─────────────────────────────

test('obs-7 — Poller-Idempotenz: INSERT OR IGNORE dupliziert nicht', () => {
  const db = buildDb();

  const stmtInsert = db.prepare(
    `INSERT OR IGNORE INTO station_obs (station_key, ts, wind_ms, gust_ms, lat, lon)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const ts = '2026-08-06T12:00:00.000Z';
  stmtInsert.run('talamone', ts, 5.0, 8.0, 42.554, 11.128);
  stmtInsert.run('talamone', ts, 9.9, 15.0, 42.554, 11.128); // selber PK → ignoriert

  const rows = db.prepare('SELECT * FROM station_obs WHERE station_key=? AND ts=?')
    .all('talamone', ts);
  assert.equal(rows.length, 1, 'Nur 1 Eintrag erwartet (INSERT OR IGNORE)');
  assert.equal(rows[0].wind_ms, 5.0, 'Erster Wert muss erhalten bleiben');

  db.close();
});

// ── Test 8: Poller — Prune: nur Einträge > 14d werden gelöscht ───────────────

test('obs-8 — Prune: nur Obs älter als 14 Tage gelöscht', () => {
  const db = buildDb();

  const stmtInsert = db.prepare(
    `INSERT OR IGNORE INTO station_obs (station_key, ts, wind_ms, gust_ms, lat, lon)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const stmtPrune = db.prepare(
    `DELETE FROM station_obs WHERE ts < ?`
  );

  const now = new Date();
  // Eintrag: 15 Tage alt (soll gelöscht werden)
  const old15d = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
  // Eintrag: 13 Tage alt (soll bleiben)
  const recent13d = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000).toISOString();
  // Eintrag: aktuell (soll bleiben)
  const current = now.toISOString();

  stmtInsert.run('talamone', old15d,   5.0, 8.0, 42.554, 11.128);
  stmtInsert.run('talamone', recent13d, 6.0, 9.0, 42.554, 11.128);
  stmtInsert.run('talamone', current,  7.0, 10.0, 42.554, 11.128);

  // Prune: alles älter als 14 Tage
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const result = stmtPrune.run(cutoff);
  assert.equal(result.changes, 1, '1 alter Eintrag soll gelöscht werden');

  const remaining = db.prepare('SELECT * FROM station_obs').all();
  assert.equal(remaining.length, 2, '2 Einträge sollen übrig bleiben');

  // Sicherstellen dass der alte weg ist
  const oldStillThere = remaining.find(r => r.ts === old15d);
  assert(!oldStillThere, '15-Tage-alter Eintrag soll gelöscht sein');

  db.close();
});

// ── Test 9: Fehler einer Station bricht die Schleife nicht (Logik-Test) ──────

test('obs-9 — Fehler pro Station isoliert: restliche Stationen werden verarbeitet', () => {
  // Simuliert die Poller-Logik: Station 1 wirft, Station 2 soll trotzdem laufen.
  const db = buildDb();

  const stmtInsert = db.prepare(
    `INSERT OR IGNORE INTO station_obs (station_key, ts, wind_ms, gust_ms, lat, lon)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const ts = new Date().toISOString();
  const stations = [
    { key: 'station-error', lat: 0, lon: 0, fail: true },
    { key: 'talamone',      lat: 42.554, lon: 11.128, wind: 5.0, gust: 8.0 },
  ];

  let errorCaught = false;
  for (const st of stations) {
    try {
      if (st.fail) throw new Error('Simulated station fetch error');
      stmtInsert.run(st.key, ts, st.wind, st.gust, st.lat, st.lon);
    } catch (e) {
      errorCaught = true;
      // Fehler abgefangen — Schleife läuft weiter
    }
  }

  assert(errorCaught, 'Fehler der ersten Station soll gefangen worden sein');

  const rows = db.prepare('SELECT * FROM station_obs WHERE station_key=?').all('talamone');
  assert.equal(rows.length, 1, 'Zweite Station soll trotzdem verarbeitet worden sein');

  db.close();
});
