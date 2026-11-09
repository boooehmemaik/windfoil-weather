// ============================================================================
// WindFoil — Schema 010_wind_alerts
// ----------------------------------------------------------------------------
// Die Garantien des Windalarms stecken zur Hälfte im Schema: die Entprellung
// ist ein Primärschlüssel, die Schwellenprüfung ein CHECK, das Aufräumen bei
// Kontolöschung ein ON DELETE CASCADE. Ohne Test wäre das nur Absicht.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID as uuid } from 'node:crypto';

const MIG_DIR = new URL('./db/migrations/', import.meta.url);

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at TEXT);');
  for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'));
  }
  return db;
}

const NOW = new Date().toISOString();

function withUser() {
  const db = freshDb();
  const uid = uuid();
  db.prepare('INSERT INTO user VALUES (?,?,?,?)').run(uid, `${uid}@example.com`, 'Maik', NOW);
  return { db, uid };
}

const addAlert = (db, uid, spot, score) =>
  db.prepare('INSERT INTO wind_alerts (user_id, spot_id, min_score, created_at) VALUES (?,?,?,?)')
    .run(uid, spot, score, NOW);

const addDevice = (db, uid, endpoint) =>
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at)
              VALUES (?,?,?,?,?,?)`).run(endpoint, uid, 'p', 'a', 'ua', NOW);

test('min_score ist auf 1–100 begrenzt', () => {
  const { db, uid } = withUser();
  addAlert(db, uid, 's_porto_pollo', 70);
  assert.throws(() => addAlert(db, uid, 'x1', 0), /CHECK/i);
  assert.throws(() => addAlert(db, uid, 'x2', 101), /CHECK/i);
  addAlert(db, uid, 'x3', 1);
  addAlert(db, uid, 'x4', 100);
});

test('ein Abo je Nutzer und Spot — das Upsert ändert nur die Schwelle', () => {
  const { db, uid } = withUser();
  addAlert(db, uid, 's_stintino', 70);
  db.prepare(`INSERT INTO wind_alerts (user_id, spot_id, min_score, created_at) VALUES (?,?,?,?)
              ON CONFLICT(user_id, spot_id) DO UPDATE SET min_score = excluded.min_score`)
    .run(uid, 's_stintino', 85, NOW);

  const rows = db.prepare('SELECT min_score FROM wind_alerts WHERE user_id = ?').all(uid);
  assert.strictEqual(rows.length, 1, 'Abo wurde dupliziert');
  assert.strictEqual(rows[0].min_score, 85);
});

test('die Entprellung lässt einen Spot-Tag nur einmal zu', () => {
  const { db, uid } = withUser();
  const ins = db.prepare('INSERT INTO wind_alert_sent VALUES (?,?,?,?,?)');
  ins.run(uid, 's_stintino', '2026-11-10', 84, NOW);
  assert.throws(() => ins.run(uid, 's_stintino', '2026-11-10', 91, NOW), /UNIQUE/i);
  // Anderer Tag und anderer Spot bleiben erlaubt.
  ins.run(uid, 's_stintino', '2026-11-11', 77, NOW);
  ins.run(uid, 's_porto_pollo', '2026-11-10', 77, NOW);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM wind_alert_sent').get().n, 3);
});

test('derselbe Endpunkt gehört immer nur einem Konto', () => {
  const db = freshDb();
  const [a, b] = [uuid(), uuid()];
  for (const id of [a, b]) db.prepare('INSERT INTO user VALUES (?,?,?,?)').run(id, `${id}@x.de`, 'u', NOW);
  const ep = 'https://push.example/abc';
  addDevice(db, a, ep);
  // Geteiltes Gerät: der neue Nutzer übernimmt, statt ein zweites Abo anzulegen.
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, fail_count = 0`)
    .run(ep, b, 'p', 'a', 'ua', NOW);

  const rows = db.prepare('SELECT user_id FROM push_subscriptions').all();
  assert.deepStrictEqual(rows.map(r => r.user_id), [b]);
});

test('ein gelöschtes Konto nimmt Abos, Geräte und Protokoll mit', () => {
  const { db, uid } = withUser();
  addAlert(db, uid, 's_stintino', 70);
  addDevice(db, uid, 'https://push.example/one');
  db.prepare('INSERT INTO wind_alert_sent VALUES (?,?,?,?,?)').run(uid, 's_stintino', '2026-11-10', 84, NOW);

  db.prepare('DELETE FROM user WHERE id = ?').run(uid);
  for (const t of ['wind_alerts', 'push_subscriptions', 'wind_alert_sent']) {
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, `${t} nicht aufgeräumt`);
  }
});

test('ein Abo ohne Konto wird abgewiesen', () => {
  const db = freshDb();
  assert.throws(() => addAlert(db, 'geisternutzer', 's_stintino', 70), /FOREIGN KEY/i);
});
