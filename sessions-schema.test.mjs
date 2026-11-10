// ============================================================================
// WindFoil — Schema 011_session_log
// ----------------------------------------------------------------------------
// Das Logbuch erbt sein Schema aus 001_init. Geprüft wird hier, dass Migration
// 011 die Bestandsdaten nicht anfasst, dass `backfilled` die richtige Vorgabe
// hat, und dass die Aufräumkette bis zu den Forecast-Snapshots durchläuft.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';

const MIG_DIR = new URL('./db/migrations/', import.meta.url);
const NOW = new Date().toISOString();

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at TEXT);');
  for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'));
  }
  return db;
}

function withSpot() {
  const db = freshDb();
  const uid = uuid();
  db.prepare('INSERT INTO user VALUES (?,?,?,?)').run(uid, `${uid}@example.com`, 'Maik', NOW);
  db.prepare(`INSERT INTO spots (id, user_id, name, latitude, longitude, timezone, created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run('s_stintino', null, 'Stintino', 40.94, 8.23, 'Europe/Rome', NOW);
  return { db, uid };
}

function addSession(db, uid, date, extra = {}) {
  const id = uuid();
  db.prepare(`INSERT INTO sessions
      (id, user_id, spot_id, session_date, wing_m2, rating, backfilled, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, uid, 's_stintino', date, extra.wingM2 ?? 6, extra.rating ?? null,
         extra.backfilled ?? 0, NOW, NOW);
  return id;
}

test('backfilled ist NOT NULL und steht ohne Angabe auf 0', () => {
  const { db, uid } = withSpot();
  const col = db.prepare("SELECT * FROM pragma_table_info('sessions')").all()
    .find(c => c.name === 'backfilled');
  assert.ok(col, 'Spalte backfilled fehlt');
  assert.strictEqual(col.notnull, 1, 'backfilled muss NOT NULL sein');

  // Bestandszeilen aus der Zeit vor 011 waren immer am Tag der Session —
  // die Vorgabe 0 muss deshalb gelten, ohne dass jemand sie setzt.
  const id = uuid();
  db.prepare(`INSERT INTO sessions (id, user_id, spot_id, session_date, created_at, updated_at)
              VALUES (?,?,?,?,?,?)`).run(id, uid, 's_stintino', '2026-11-10', NOW, NOW);
  assert.strictEqual(db.prepare('SELECT backfilled FROM sessions WHERE id = ?').get(id).backfilled, 0);
});

test('backfilled lässt sich auf 1 setzen und bleibt unterscheidbar', () => {
  const { db, uid } = withSpot();
  addSession(db, uid, '2026-11-10', { backfilled: 0 });
  addSession(db, uid, '2026-11-07', { backfilled: 1 });

  const rows = db.prepare(
    'SELECT session_date, backfilled FROM sessions WHERE user_id = ? ORDER BY session_date DESC').all(uid);
  assert.deepStrictEqual(rows.map(r => r.backfilled), [0, 1]);
});

test('der Teilindex deckt nur die nachgetragenen Einträge ab', () => {
  const { db } = withSpot();
  const idx = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_sessions_backfilled'").get();
  assert.ok(idx, 'idx_sessions_backfilled fehlt');
  assert.match(idx.sql, /WHERE backfilled = 1/i);
});

test('ein gelöschtes Konto nimmt Sessions und Forecast-Snapshots mit', () => {
  const { db, uid } = withSpot();
  const sid = addSession(db, uid, '2026-11-10');
  db.prepare(`INSERT INTO forecast_snapshots
      (id, session_id, source, predicted_score, predicted_wind_kt, captured_at)
      VALUES (?,?,?,?,?,?)`).run(uuid(), sid, 'foil-score', 84, 16.5, NOW);

  db.prepare('DELETE FROM user WHERE id = ?').run(uid);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM forecast_snapshots').get().n, 0,
    'Snapshots müssen über sessions.id kaskadieren');
});

test('forecast_snapshots akzeptiert nur bekannte Quellen', () => {
  const { db, uid } = withSpot();
  const sid = addSession(db, uid, '2026-11-10');
  const ins = db.prepare(`INSERT INTO forecast_snapshots
      (id, session_id, source, predicted_score, captured_at) VALUES (?,?,?,?,?)`);
  ins.run(uuid(), sid, 'foil-score', 84, NOW);
  assert.throws(() => ins.run(uuid(), sid, 'erfunden', 84, NOW), /CHECK/i);
});

test('der Guard erkennt einen vorhandenen Snapshot je Quelle', () => {
  // Dieselbe Abfrage wie hasSnapshot() in src/sessions.store.mjs. Ohne sie legte
  // POST /api/feedback bei jeder Bearbeitung einen weiteren Soll-Wert an — der
  // wäre schon nachgeführt und würde den Abgleich schönrechnen.
  const { db, uid } = withSpot();
  const sid = addSession(db, uid, '2026-11-10');
  const guard = db.prepare(
    'SELECT 1 FROM forecast_snapshots WHERE session_id = ? AND source = ? LIMIT 1');

  assert.strictEqual(guard.get(sid, 'foil-score'), undefined, 'vorher darf nichts da sein');
  db.prepare(`INSERT INTO forecast_snapshots
      (id, session_id, source, predicted_score, captured_at) VALUES (?,?,?,?,?)`)
    .run(uuid(), sid, 'foil-score', 84, NOW);
  assert.ok(guard.get(sid, 'foil-score'), 'nachher muss der Guard greifen');
  // Die Quelle ist Teil des Schlüssels: ein station-mos-Snapshot blockiert
  // keinen foil-score-Snapshot.
  assert.strictEqual(guard.get(sid, 'station-mos'), undefined);
});

test('der Leseweg verbindet den ältesten Snapshot und vervielfacht die Zeile nicht', () => {
  // Spiegelt SELECT_SESSION aus src/sessions.store.mjs. Ein LEFT JOIN auf
  // session_id allein würde bei zwei Snapshots zwei Logbuchzeilen ergeben.
  const { db, uid } = withSpot();
  const sid = addSession(db, uid, '2026-11-10');
  const ins = db.prepare(`INSERT INTO forecast_snapshots
      (id, session_id, source, predicted_score, captured_at) VALUES (?,?,?,?,?)`);
  ins.run(uuid(), sid, 'foil-score', 55, '2026-11-09T06:00:00Z');
  ins.run(uuid(), sid, 'foil-score', 95, '2026-11-10T18:00:00Z');

  const rows = db.prepare(`
    SELECT s.id, f.predicted_score
      FROM sessions s
      LEFT JOIN forecast_snapshots f ON f.id = (
        SELECT x.id FROM forecast_snapshots x
         WHERE x.session_id = s.id AND x.source = ?
         ORDER BY x.captured_at ASC LIMIT 1)
     WHERE s.user_id = ?`).all('foil-score', uid);

  assert.strictEqual(rows.length, 1, 'eine Session bleibt eine Zeile');
  assert.strictEqual(rows[0].predicted_score, 55, 'der ältere Soll-Wert zählt');
});

test('mehrere Sessions je Spot und Tag sind schemaseitig möglich — die Route muss das verhindern', () => {
  // Es gibt bewusst kein UNIQUE(user_id, spot_id, session_date): die Eindeutigkeit
  // hängt an POST /api/feedback (SELECT, dann INSERT oder UPDATE in einer
  // Transaktion). Das ist nur sicher, solange der Server EIN Prozess ist und
  // better-sqlite3 synchron arbeitet. Dieser Test hält die Annahme fest —
  // wird je mit cluster/fork oder mehreren Instanzen deployt, muss ein
  // UNIQUE-Index nachgezogen werden, und dann wird dieser Test rot.
  const { db, uid } = withSpot();
  addSession(db, uid, '2026-11-10');
  addSession(db, uid, '2026-11-10');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) n FROM sessions WHERE session_date = ?').get('2026-11-10').n, 2);
});
