// ============================================================================
// WindFoil — Session-Logbuch: Persistenz
// ----------------------------------------------------------------------------
// Nur SQL. Jede Abfrage filtert auf user_id — es gibt keinen Weg, über eine
// Session-ID an fremde Einträge zu kommen. Die Auswertung liegt in
// src/sessions.mjs, die HTTP-Schicht in src/sessions.routes.mjs.
// ============================================================================
import { db } from './db.mjs';
import WF from '../js/wf-scoring.js';

export const SNAPSHOT_SOURCE = 'foil-score';

/** Fahrerfenster eines Nutzers. Fehlendes oder kaputtes Profil → Referenzfahrer,
 *  damit das Logbuch nie leer bleibt, nur weil kein Profil gepflegt ist. */
export function riderWindow(userId) {
  const row = db.prepare(
    "SELECT value FROM user_prefs WHERE user_id = ? AND key = 'wf_rider'").get(userId);
  if (!row) return WF.guestWindow();
  try {
    return WF.windowFromRider(JSON.parse(row.value)) || WF.guestWindow();
  } catch {
    return WF.guestWindow();
  }
}

// `forecast_snapshots` kennt kein UNIQUE(session_id, source), und der
// Feedback-Pfad legte bisher bei jeder Bearbeitung einen weiteren Snapshot an.
// Deshalb wird hier gezielt der ÄLTESTE verbunden: nur der hält fest, was vor
// der Session vorhergesagt war. Ein LEFT JOIN auf session_id würde Einträge
// stattdessen vervielfachen.
const SELECT_SESSION = `
  SELECT s.id, s.spot_id, s.session_date, s.started_at, s.ended_at,
         s.wing_m2, s.range_low_kt, s.range_high_kt,
         s.planed, s.rating, s.conditions_matched, s.notes,
         s.backfilled, s.created_at, s.updated_at,
         sp.name AS spot_name, sp.timezone AS spot_timezone,
         f.predicted_score, f.predicted_wind_kt,
         f.predicted_window_start, f.predicted_window_end, f.captured_at
    FROM sessions s
    JOIN spots sp ON sp.id = s.spot_id
    LEFT JOIN forecast_snapshots f ON f.id = (
      SELECT x.id FROM forecast_snapshots x
       WHERE x.session_id = s.id AND x.source = ?
       ORDER BY x.captured_at ASC LIMIT 1)
   WHERE s.user_id = ?`;

export const MAX_PAGE = 100;

/** Logbuchseite, neueste zuerst. `before` ist der session_date der letzten
 *  gelieferten Zeile — Cursor statt OFFSET, damit ein neuer Eintrag die
 *  Paginierung nicht verschiebt. */
export function listSessions(userId, { limit = 30, before = null } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 30, 1), MAX_PAGE);
  const sql = `${SELECT_SESSION}${before ? ' AND s.session_date < ?' : ''}
               ORDER BY s.session_date DESC, s.created_at DESC LIMIT ?`;
  const args = before
    ? [SNAPSHOT_SOURCE, userId, before, n]
    : [SNAPSHOT_SOURCE, userId, n];
  return db.prepare(sql).all(...args);
}

export function getSession(userId, id) {
  return db.prepare(`${SELECT_SESSION} AND s.id = ?`).get(SNAPSHOT_SOURCE, userId, id) || null;
}

/** → true, wenn tatsächlich gelöscht wurde. Fremde IDs ergeben false, nicht 500. */
export function deleteSession(userId, id) {
  return db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/** Kennzahlen über das gesamte Logbuch — billig, weil idx_sessions_user_date greift. */
export function sessionStats(userId) {
  const row = db.prepare(`
    SELECT COUNT(*)                      AS total,
           COUNT(DISTINCT spot_id)       AS spots,
           SUM(backfilled)               AS backfilled,
           AVG(rating)                   AS avgRating,
           MIN(session_date)             AS firstDate,
           MAX(session_date)             AS lastDate
      FROM sessions WHERE user_id = ?`).get(userId);
  return {
    total: row?.total || 0,
    spots: row?.spots || 0,
    backfilled: row?.backfilled || 0,
    avgRating: row?.avgRating == null ? null : Math.round(row.avgRating * 10) / 10,
    firstDate: row?.firstDate || null,
    lastDate: row?.lastDate || null,
  };
}

/** Gibt es für diese Session schon einen Soll-Wert? */
export function hasSnapshot(sessionId, source = SNAPSHOT_SOURCE) {
  return !!db.prepare(
    'SELECT 1 FROM forecast_snapshots WHERE session_id = ? AND source = ? LIMIT 1')
    .get(sessionId, source);
}

/** Schreibt den Soll-Wert — aber nur einmal je Session.
 *  Ein zweiter Snapshot wäre bereits nachgeführt und würde den Abgleich
 *  schönrechnen. → true, wenn geschrieben wurde. */
export function saveSnapshot({ id, sessionId, rated, date, source = SNAPSHOT_SOURCE, now }) {
  if (!rated || hasSnapshot(sessionId, source)) return false;
  const iso = h => (h == null ? null : `${date}T${String(h).padStart(2, '0')}:00:00`);
  db.prepare(`INSERT INTO forecast_snapshots
      (id, session_id, source, predicted_score, predicted_wind_kt,
       predicted_window_start, predicted_window_end, raw_json, captured_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, sessionId, source, rated.score, rated.windKn ?? null,
         iso(rated.startHour), iso(rated.endHour), JSON.stringify(rated), now);
  return true;
}
