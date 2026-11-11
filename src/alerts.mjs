// ============================================================================
// WindFoil — Windalarm: Auswertung
// ----------------------------------------------------------------------------
// Bewusst REIN: kein Netz, kein DB-Handle, keine Uhr aus dem Nichts. Alles
// kommt als Argument herein, damit die Entscheidung "wer bekommt wofür einen
// Push" vollständig testbar ist. Die Seiteneffekte liegen in
// src/push.mjs (Auslieferung) und src/alerts.routes.mjs (Persistenz).
// ============================================================================
import WF from '../js/wf-scoring.js';

// 40 statt 70: bei 70 schlug der Alarm an mitteleuropäischen Spots über Wochen
// nicht an, und ein Alarm, der nie kommt, ist von einem defekten Alarm nicht
// zu unterscheiden. Jede Regel lässt sich einzeln nachschärfen.
export const DEFAULT_MIN_SCORE = 40;

// Fest auf 5 Tage, nicht aus Bequemlichkeit: genau diesen Cache-Eintrag
// (region=all&days=5) füllt die Vergleichsseite ohnehin. Der Alarm kostet
// damit keinen zusätzlichen Open-Meteo-Call.
export const LOOKAHEAD_DAYS = 5;

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const pad2 = n => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 'Do' (UTC-fest, damit kein Serverzeitzonen-Drift entsteht). */
export function weekday(date) {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** Tagesblöcke der Stundenreihe → [{ date, start }].
 *  Nur vollständige Tage: ein Tag, dessen Reihe vor 18 Uhr endet, würde eine
 *  abgeschnittene Session bewerten und dafür einen Push auslösen. */
export function splitDays(hourly) {
  const time = hourly?.time;
  if (!Array.isArray(time)) return [];
  const days = [];
  const seen = new Set();
  time.forEach((t, i) => {
    const date = String(t).slice(0, 10);
    if (seen.has(date)) return;
    seen.add(date);
    if (String(t).slice(11, 16) !== '00:00') return;
    if (i + WF.LAST_END - 1 >= time.length) return;
    days.push({ date, start: i });
  });
  return days;
}

/** Liegt der Sessionbeginn noch in der Zukunft?
 *  Die Reihe ist Ortszeit ohne Zone — ohne Offset wird UTC angenommen, dann
 *  verwirft der Filter im Zweifel zu viel statt zu wenig. */
function startsLater(date, startHour, offsetSeconds, now) {
  const localAsUtc = Date.parse(`${date}T${pad2(startHour)}:00:00Z`);
  return localAsUtc - (offsetSeconds || 0) * 1000 > now.getTime();
}

/** Welcher Tag ist am Spot gerade? Nicht der Serverkalender: in Sardinien ist
 *  um 00:30 Ortszeit schon der nächste Tag, auf einem UTC-Server noch nicht —
 *  „heute" würde sonst den falschen Tag meinen. */
function localToday(offsetSeconds, now) {
  return new Date(now.getTime() + (offsetSeconds || 0) * 1000).toISOString().slice(0, 10);
}

/** Abstand in Tagen zwischen zwei 'YYYY-MM-DD'. 12:00 als Bezug, damit keine
 *  Sommerzeitgrenze ein Ergebnis um einen halben Tag verschiebt. */
function dayDiff(date, from) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Tagesbezeichnung für die Benachrichtigung.
 *  „Di" allein verrät nicht, ob das heute oder in vier Tagen ist — und genau
 *  das ist die Information, nach der man beim Lesen sucht. Ab dem dritten Tag
 *  gibt es keine gängige Vokabel mehr, dann Wochentag plus Datum. Ein
 *  unbekannter Abstand fällt auf dieselbe Form zurück: lieber Wochentag und
 *  Datum als ein falsches „heute". */
export function dayLabel(offset, date) {
  if (offset === 0) return 'heute';
  if (offset === 1) return 'morgen';
  if (offset === 2) return 'übermorgen';
  return `${weekday(date)} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Mittlerer Wind der Session in Knoten — der Score allein sagt nicht, ob es
 *  12 oder 25 kn werden. Exportiert, weil das Logbuch (src/sessions.mjs) exakt
 *  dieselbe Mittelung braucht, um Soll und Ist vergleichbar zu halten. */
export function sessionWindKn(winds, start, from, to) {
  const vals = [];
  for (let h = from; h < to; h++) {
    const v = winds[start + h];
    if (v !== undefined && v !== null) vals.push(v);
  }
  return vals.length ? Math.round(WF.msToKn(mean(vals))) : null;
}

/** Tageswertung eines Spots → [{ date, dayOffset, score, startHour, endHour, windKn }].
 *  Vergangene Sessions fallen raus, nicht erst beim Versand.
 *  dayOffset entsteht hier und nicht erst beim Formatieren: nur an dieser Stelle
 *  ist der Zeitzonen-Offset des Spots bekannt. */
export function spotDayScores(entry, win, spot, now, lookaheadDays = LOOKAHEAD_DAYS) {
  const hourly = entry?.hourly;
  if (!hourly?.windspeed_10m) return [];
  const today = localToday(entry.utcOffsetSeconds, now);
  const out = [];
  for (const { date, start } of splitDays(hourly).slice(0, lookaheadDays)) {
    const best = WF.bestSession(hourly.windspeed_10m, win, {
      start,
      dirs: hourly.winddirection_10m,
      offshoreDir: spot?.offshoreDir ?? null,
    });
    if (!best.score || best.startHour === null) continue;
    if (!startsLater(date, best.startHour, entry.utcOffsetSeconds, now)) continue;
    out.push({
      date, dayOffset: dayDiff(date, today), score: best.score,
      startHour: best.startHour, endHour: best.endHour,
      windKn: sessionWindKn(hourly.windspeed_10m, start, best.startHour, best.endHour),
    });
  }
  return out;
}

const winKey = w => `${w.minWind}|${w.optMin}|${w.optMax}|${w.maxWind}`;

/** Wer bekommt wofür einen Alarm?
 *  forecast      — { spots: { [id]: { hourly, utcOffsetSeconds } | null } }
 *  spots         — { [id]: { name, emoji, offshoreDir } }
 *  subscriptions — [{ userId, spotId, minScore }]
 *  windows       — { [userId]: Fenster aus WF.windowFromRider }
 *  sent          — Set von 'userId|spotId|date'
 *  → [{ userId, hits: [{ spotId, name, emoji, date, score, startHour, endHour, windKn }] }]
 */
export function evaluateAlerts({ forecast, spots = {}, subscriptions = [],
                                 windows = {}, sent = new Set(), now = new Date(),
                                 lookaheadDays = LOOKAHEAD_DAYS } = {}) {
  const fc = forecast?.spots || {};
  // Viele Nutzer teilen dasselbe Fenster (Gäste, gleiche Profile) — ohne Memo
  // würde bestSession pro Abo erneut über 120 Stunden laufen.
  const memo = new Map();
  const scoresFor = (spotId, win) => {
    const k = `${spotId}|${winKey(win)}`;
    if (!memo.has(k)) {
      memo.set(k, spotDayScores(fc[spotId], win, spots[spotId], now, lookaheadDays));
    }
    return memo.get(k);
  };

  const byUser = new Map();
  for (const sub of subscriptions) {
    if (!fc[sub.spotId]) continue;
    const win = windows[sub.userId] || WF.guestWindow();
    const meta = spots[sub.spotId] || {};
    for (const day of scoresFor(sub.spotId, win)) {
      // Knoten-Modus: Schwelle gegen den mittleren Sessionwind prüfen.
      // Ist windKn nicht berechenbar, fällt die Prüfung auf den Score zurück.
      if (sub.minKn && day.windKn != null) {
        if (day.windKn < sub.minKn) continue;
      } else {
        const min = sub.minScore || DEFAULT_MIN_SCORE;
        if (day.score < min) continue;
      }
      if (sent.has(`${sub.userId}|${sub.spotId}|${day.date}`)) continue;
      if (!byUser.has(sub.userId)) byUser.set(sub.userId, []);
      byUser.get(sub.userId).push({
        spotId: sub.spotId, name: meta.name || sub.spotId, emoji: meta.emoji || '🌬️', ...day,
      });
    }
  }

  return [...byUser].map(([userId, hits]) => ({
    userId,
    // Bester Tag zuerst: die Push-Nachricht zeigt nur die Spitze.
    hits: hits.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)),
  }));
}

const hitLine = h =>
  `${h.name} ${dayLabel(h.dayOffset, h.date)} ${h.startHour}–${h.endHour} Uhr · Score ${h.score}`
  + (h.windKn ? ` · ${h.windKn} kn` : '');

/** Push-Nutzlast für einen Nutzer. Mehrere Treffer werden zusammengefasst —
 *  40 Spots dürfen nicht 40 Benachrichtigungen ergeben.
 *  Der Tagesbezug steht schon im Titel: auf dem Sperrbildschirm ist der Rumpf
 *  oft zugeklappt, und „wann" ist die erste Frage. */
export function formatAlert(hits) {
  const top = hits[0];
  const when = dayLabel(top.dayOffset, top.date);
  const title = hits.length === 1
    ? `${top.emoji} ${top.name} ${when}: Score ${top.score}`
    : `${top.emoji} ${hits.length} Alarme — top ${top.name} ${when} (${top.score})`;
  return {
    title,
    body: hits.slice(0, 3).map(hitLine).join('\n'),
    url: `/vergleich.html#${top.spotId}`,
    // Gleicher Tag = gleicher Tag: ein ersetzender Push statt eines Stapels.
    tag: `wf-alert-${top.date}`,
  };
}
