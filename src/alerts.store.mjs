// ============================================================================
// WindFoil — Windalarm: Persistenz
// ----------------------------------------------------------------------------
// Ausschließlich SQL. Die Entscheidungslogik liegt in src/alerts.mjs, die
// Orchestrierung in src/alerts.scheduler.mjs — beide sind damit ohne DB
// testbar, weil sie nur die hier definierte Schnittstelle sehen.
// ============================================================================
import { db } from './db.mjs';
import { DEFAULT_MIN_SCORE } from './alerts.mjs';

const nowIso = () => new Date().toISOString();

// ── Abos (Spot + Schwelle) ──────────────────────────────────────────────────

export function listAlerts(userId) {
  return db.prepare('SELECT spot_id AS spotId, min_score AS minScore, min_kn AS minKn FROM wind_alerts WHERE user_id = ?')
    .all(userId);
}

/** minKn=null → Score-Modus; minKn=N → Knoten-Modus (min_score bleibt als Fallback). */
export function upsertAlert(userId, spotId, minScore = DEFAULT_MIN_SCORE, minKn = null) {
  db.prepare(`INSERT INTO wind_alerts (user_id, spot_id, min_score, min_kn, created_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(user_id, spot_id) DO UPDATE SET
                min_score = excluded.min_score, min_kn = excluded.min_kn`)
    .run(userId, spotId, minScore, minKn, nowIso());
}

export function deleteAlert(userId, spotId) {
  return db.prepare('DELETE FROM wind_alerts WHERE user_id = ? AND spot_id = ?')
    .run(userId, spotId).changes;
}

// ── Geräte ──────────────────────────────────────────────────────────────────

export function saveDevice(userId, { endpoint, p256dh, auth, ua }) {
  // Wechselt ein Endpunkt den Besitzer (geteiltes Gerät, Abmeldung), gewinnt
  // der neue Nutzer — der Endpunkt ist der Primärschlüssel.
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(endpoint) DO UPDATE SET
                user_id = excluded.user_id, p256dh = excluded.p256dh,
                auth = excluded.auth, ua = excluded.ua, fail_count = 0`)
    .run(endpoint, userId, p256dh, auth, ua || null, nowIso());
}

export function deleteDevice(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes;
}

export function devicesOf(userId) {
  return db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId);
}

export function countDevices(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n;
}

export function markDeviceOk(endpoint) {
  db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, fail_count = 0 WHERE endpoint = ?')
    .run(nowIso(), endpoint);
}

export function markDeviceFail(endpoint, maxFails = 10) {
  db.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = ?')
    .run(endpoint);
  // Nicht jeder Push-Dienst meldet ein totes Abo mit 410 — ab zehn Fehlschlägen
  // wird der Endpunkt trotzdem entsorgt.
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND fail_count >= ?')
    .run(endpoint, maxFails);
}

// ── Auswertung ──────────────────────────────────────────────────────────────

/** Nur Abos von Nutzern, die überhaupt ein Gerät registriert haben — für alle
 *  anderen wäre die Auswertung Rechenzeit ohne Empfänger. */
export function deliverableAlerts() {
  return db.prepare(`
    SELECT a.user_id AS userId, a.spot_id AS spotId, a.min_score AS minScore, a.min_kn AS minKn
    FROM wind_alerts a
    WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = a.user_id)`).all();
}

/** Fahrerfenster-Rohdaten: der Pref-Blob wf_rider je Nutzer mit Abo. */
export function riderPrefs() {
  const rows = db.prepare(`
    SELECT user_id AS userId, value FROM user_prefs
    WHERE key = 'wf_rider' AND user_id IN (SELECT DISTINCT user_id FROM wind_alerts)`).all();
  const out = {};
  for (const r of rows) {
    try { out[r.userId] = JSON.parse(r.value); } catch { /* kaputter Blob → Referenzfahrer */ }
  }
  return out;
}

export function sentKeys(sinceDay) {
  const rows = db.prepare('SELECT user_id, spot_id, day FROM wind_alert_sent WHERE day >= ?')
    .all(sinceDay);
  return new Set(rows.map(r => `${r.user_id}|${r.spot_id}|${r.day}`));
}

export function markSent(rows) {
  const stmt = db.prepare(`INSERT INTO wind_alert_sent (user_id, spot_id, day, score, sent_at)
                           VALUES (?,?,?,?,?)
                           ON CONFLICT(user_id, spot_id, day) DO UPDATE SET
                             score = excluded.score, sent_at = excluded.sent_at`);
  const at = nowIso();
  db.transaction(() => {
    for (const r of rows) stmt.run(r.userId, r.spotId, r.date, r.score, at);
  })();
}

export function pruneSent(beforeDay) {
  return db.prepare('DELETE FROM wind_alert_sent WHERE day < ?').run(beforeDay).changes;
}

/** Die Schnittstelle, die der Scheduler sieht — ein Objekt, damit Tests einen
 *  Doppelgänger einsetzen können, ohne eine SQLite-Datei zu brauchen. */
export const alertStore = {
  deliverableAlerts, riderPrefs, sentKeys, markSent, pruneSent,
  devicesOf, markDeviceOk, markDeviceFail, deleteDevice,
};
