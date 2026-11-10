// ============================================================================
// WindFoil — Session-Logbuch: Schreibfenster und Forecast-Abgleich
// ----------------------------------------------------------------------------
// Rein wie src/alerts.mjs: kein Netz, kein DB-Handle, keine eigene Uhr. Der
// Tag, die Stundenreihen und das Fahrerfenster kommen als Argument herein.
// Die Seiteneffekte liegen in src/sessions.store.mjs und sessions.routes.mjs.
// ============================================================================
import WF from '../js/wf-scoring.js';
import { sessionWindKn } from './alerts.mjs';

/** Wie weit darf nachgetragen werden. Die Ist-Seite kommt aus dem
 *  ERA5-Archiv (HISTORY_DAYS = 14 in forecast.routes.mjs) — 7 Tage liegen
 *  sicher darin, auch wenn der History-Cache einen halben Tag alt ist. */
export const MAX_BACKFILL_DAYS = 7;

/** Ab dieser Score-Abweichung gilt die Vorhersage nicht mehr als getroffen.
 *  8 Punkte, weil der Score in Stufen von ~1 Punkt je 0,04 m/s läuft — kleinere
 *  Differenzen sind Modellrauschen, keine Fehlprognose. */
export const MATCH_TOLERANCE = 8;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const dayMs = d => (DATE_RE.test(String(d || '')) ? Date.parse(`${d}T00:00:00Z`) : NaN);

/** Ganze Tage zwischen zwei Kalendertagen, oder null bei Unsinn. */
export function daysBack(date, today) {
  const a = dayMs(date), b = dayMs(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/** Darf für diesen Tag geschrieben werden?
 *  → { ok: true, backfilled } | { ok: false, reason, maxDays? }
 *  `today` ist der Kalendertag in der Zeitzone des Spots — nie der des Servers
 *  und erst recht nicht der des Clients. */
export function writableDay(date, today, maxDays = MAX_BACKFILL_DAYS) {
  const diff = daysBack(date, today);
  if (diff === null) return { ok: false, reason: 'invalid_date' };
  if (diff < 0) return { ok: false, reason: 'future_day' };
  if (diff > maxDays) return { ok: false, reason: 'too_old', maxDays };
  return { ok: true, backfilled: diff > 0 };
}

/** Virtueller Index von 00:00 des gesuchten Tages.
 *  Der Forecast liefert volle Tage ab 00:00, die History nur 9–18 Uhr
 *  (trimToDaylight). Weil WF.bestSession über die Uhrzeit indexiert
 *  (winds[start + h]), genügt es, die Uhrzeit des ersten Treffers abzuziehen —
 *  damit passen beide Reihen ohne Sonderfall durch dieselbe Bewertung.
 *  Ein negativer Rückgabewert ist zulässig: gelesen wird erst ab h = 9. */
export function dayStart(hourly, date) {
  const time = hourly?.time;
  if (!Array.isArray(time) || !DATE_RE.test(String(date || ''))) return null;
  const i = time.findIndex(t => String(t).slice(0, 10) === date);
  if (i < 0) return null;
  const firstHour = Number(String(time[i]).slice(11, 13));
  if (!Number.isInteger(firstHour)) return null;
  return i - firstHour;
}

/** Beste Session eines bestimmten Tages aus einer Stundenreihe.
 *  Anders als spotDayScores in alerts.mjs wird NICHT auf Zukunft gefiltert —
 *  das Logbuch bewertet gerade die Tage, die schon vorbei sind.
 *  → { date, score, startHour, endHour, windKn } | null */
export function rateDay(entry, win, spot, date) {
  const hourly = entry?.hourly;
  const winds = hourly?.windspeed_10m;
  if (!Array.isArray(winds)) return null;
  const start = dayStart(hourly, date);
  if (start === null) return null;

  const best = WF.bestSession(winds, win, {
    start,
    dirs: hourly.winddirection_10m,
    offshoreDir: spot?.offshoreDir ?? null,
  });
  if (!best.score || best.startHour === null) return null;

  return {
    date,
    score: best.score,
    startHour: best.startHour,
    endHour: best.endHour,
    windKn: sessionWindKn(winds, start, best.startHour, best.endHour),
  };
}

/** Soll gegen Ist. Fehlt eine Seite, gibt es kein Urteil — eine erfundene
 *  Null wäre schlimmer als eine Lücke.
 *  → { deltaScore, deltaWindKn, verdict, tolerance } | null */
export function matchReport(predicted, actual, tolerance = MATCH_TOLERANCE) {
  if (!predicted || !actual) return null;
  if (typeof predicted.score !== 'number' || typeof actual.score !== 'number') return null;

  const deltaScore = actual.score - predicted.score;
  const deltaWindKn = (typeof predicted.windKn === 'number' && typeof actual.windKn === 'number')
    ? actual.windKn - predicted.windKn
    : null;

  const verdict = Math.abs(deltaScore) <= tolerance ? 'getroffen'
    : deltaScore < 0 ? 'zu optimistisch'
    : 'zu pessimistisch';

  return { deltaScore, deltaWindKn, verdict, tolerance };
}

/** Ein Logbucheintrag für die Anzeige: Session, Soll, Ist, Urteil.
 *  `session` ist die DB-Zeile, `forecast`/`history` sind die Region-Antworten
 *  aus forecast.routes.mjs ({ spots: { [id]: { hourly, … } } }). */
export function logEntry({ session, forecast, history, spots = {}, win }) {
  const spot = spots[session.spot_id];
  const date = session.session_date;
  // Der Soll-Wert steht im gespeicherten Snapshot, sobald es einen gibt: nur er
  // hält fest, was VOR der Session vorhergesagt war. Der aktuelle Forecast ist
  // ein Rückfall für den laufenden Tag und schon leicht nachgeführt.
  const predicted = session.predicted_score != null
    ? { score: session.predicted_score, windKn: session.predicted_wind_kt ?? null,
        startHour: hourOf(session.predicted_window_start), endHour: hourOf(session.predicted_window_end),
        source: 'snapshot' }
    : withSource(rateDay(forecast?.spots?.[session.spot_id], win, spot, date), 'forecast');

  const actual = withSource(rateDay(history?.spots?.[session.spot_id], win, spot, date), 'era5');

  return {
    session, spot: spot || null, date,
    predicted: predicted || null,
    actual: actual || null,
    match: matchReport(predicted, actual),
  };
}

const withSource = (rated, source) => (rated ? { ...rated, source } : null);

/** '2026-11-08T11:00:00Z' → 11. Nur die Stunde interessiert in der Anzeige. */
function hourOf(iso) {
  const h = Number(String(iso || '').slice(11, 13));
  return Number.isInteger(h) ? h : null;
}
