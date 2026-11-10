// ============================================================================
// WindFoil — Session-Logbuch: HTTP
// ----------------------------------------------------------------------------
// Mount: app.use('/api/sessions', requireAuth, sessionsRouter)
// Nur Lesen und Löschen. Geschrieben wird weiter über POST /api/feedback —
// ein zweiter Schreibpfad hätte das Schreibfenster und die Snapshot-Regel
// doppelt implementieren müssen.
// ============================================================================
import { Router } from 'express';
import { db, localDay } from './db.mjs';
import { getRegionForecast, getRegionHistory, spotsById } from './forecast.routes.mjs';
import { LOOKAHEAD_DAYS } from './alerts.mjs';
import { MAX_BACKFILL_DAYS, MATCH_TOLERANCE, logEntry } from './sessions.mjs';
import {
  riderWindow, listSessions, getSession, deleteSession, sessionStats, MAX_PAGE,
} from './sessions.store.mjs';

export const sessionsRouter = Router();

/** Forecast und History in einem Zug. Fällt eine Seite aus, liefert die andere
 *  trotzdem — ein kaputter Archiv-Call darf das Logbuch nicht leeren. */
async function series() {
  const [forecast, history] = await Promise.all([
    getRegionForecast('all', LOOKAHEAD_DAYS).catch(() => null),
    getRegionHistory('all').catch(() => null),
  ]);
  return { forecast, history };
}

/** Eine DB-Zeile → Anzeigeeintrag. Die Reihen kommen von außen, damit eine
 *  Liste mit 30 Einträgen sie nur einmal holt. */
const toEntry = (row, ctx) => logEntry({ session: row, ...ctx });

async function entryContext(userId) {
  const { forecast, history } = await series();
  return { forecast, history, spots: spotsById(), win: riderWindow(userId) };
}

// GET /api/sessions?limit=30&before=YYYY-MM-DD
sessionsRouter.get('/', async (req, res) => {
  const before = req.query.before === undefined ? null : String(req.query.before);
  if (before !== null && !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return res.status(400).json({ error: 'invalid_cursor' });
  }
  // Fehlendes limit ist der Default, ein ungültiges ein Fehler — sonst würde
  // '?limit=abc' stillschweigend als 30 durchgehen.
  const limit = req.query.limit === undefined ? 30 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    return res.status(400).json({ error: 'limit_out_of_range', max: MAX_PAGE });
  }

  const rows = listSessions(req.user.id, { limit, before });
  const ctx = await entryContext(req.user.id);
  res.json({
    sessions: rows.map(r => toEntry(r, ctx)),
    // Cursor für die nächste Seite. null heißt Ende — der Client muss nicht
    // raten, ob eine kurze Seite das Ende ist oder nur ein Zufall.
    nextBefore: rows.length === limit ? rows[rows.length - 1].session_date : null,
    stats: sessionStats(req.user.id),
    maxBackfillDays: MAX_BACKFILL_DAYS,
    matchTolerance: MATCH_TOLERANCE,
  });
});

/** Welche Tage darf der Nutzer für diesen Spot eintragen?
 *  Der Tag kommt aus der Zeitzone des Spots, nicht aus der Uhr des Browsers —
 *  sonst weicht die Auswahl von dem ab, was POST /api/feedback akzeptiert. */
sessionsRouter.get('/window', (req, res) => {
  const spotId = String(req.query.spot || '');
  // Gleiche Sichtbarkeitsregel wie getSpot() im Feedback-Pfad: global oder
  // eigen. Sonst gäbe die Antwort Name und Zeitzone fremder Spots preis.
  const spot = db.prepare(
    'SELECT id, name, timezone FROM spots WHERE id = ? AND (user_id IS NULL OR user_id = ?)')
    .get(spotId, req.user.id);
  if (!spot) return res.status(404).json({ error: 'unknown_spot' });

  const today = localDay(spot.timezone);
  const dates = [];
  for (let i = 0; i <= MAX_BACKFILL_DAYS; i++) {
    dates.push(new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10));
  }
  res.json({ spotId: spot.id, timezone: spot.timezone, today, dates, maxBackfillDays: MAX_BACKFILL_DAYS });
});

sessionsRouter.get('/:id', async (req, res) => {
  const row = getSession(req.user.id, String(req.params.id));
  if (!row) return res.status(404).json({ error: 'unknown_session' });
  res.json({ session: toEntry(row, await entryContext(req.user.id)) });
});

sessionsRouter.delete('/:id', (req, res) => {
  if (!deleteSession(req.user.id, String(req.params.id))) {
    return res.status(404).json({ error: 'unknown_session' });
  }
  res.json({ ok: true });
});
