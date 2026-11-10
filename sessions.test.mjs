// ============================================================================
// WindFoil — Session-Logbuch: Schreibfenster und Forecast-Abgleich
// ----------------------------------------------------------------------------
// Alle Erwartungen sind gegen die echte Scoring-Implementierung ermittelt, nicht
// geschätzt. Gästefenster: minWind 6.6 · optMin 7.9 · optMax 13.1 · maxWind 17.1
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert';
import WF from './js/wf-scoring.js';
import {
  MAX_BACKFILL_DAYS, MATCH_TOLERANCE,
  daysBack, writableDay, dayStart, rateDay, matchReport, logEntry,
} from './src/sessions.mjs';

const WIN = WF.guestWindow();
const DATE = '2026-11-08';

/** Volltag 00:00–23:00 wie der Forecast ihn liefert. */
function fullDay(windByHour, dirByHour) {
  const time = [], windspeed_10m = [], winddirection_10m = [];
  for (let h = 0; h < 24; h++) {
    time.push(`${DATE}T${String(h).padStart(2, '0')}:00`);
    windspeed_10m.push(windByHour(h));
    winddirection_10m.push(dirByHour ? dirByHour(h) : 0);
  }
  return { hourly: { time, windspeed_10m, ...(dirByHour ? { winddirection_10m } : {}) } };
}

/** Nur 09:00–18:00 wie trimToDaylight es aus dem ERA5-Archiv liefert. */
function daylightOnly(windByHour) {
  const time = [], windspeed_10m = [];
  for (let h = 9; h <= 18; h++) {
    time.push(`${DATE}T${String(h).padStart(2, '0')}:00`);
    windspeed_10m.push(windByHour(h));
  }
  return { hourly: { time, windspeed_10m } };
}

const flat = v => () => v;

// ── Schreibfenster ──────────────────────────────────────────────────────────

test('daysBack zählt Kalendertage und weist Unsinn ab', () => {
  assert.strictEqual(daysBack('2026-11-08', '2026-11-10'), 2);
  assert.strictEqual(daysBack('2026-11-10', '2026-11-10'), 0);
  assert.strictEqual(daysBack('2026-11-11', '2026-11-10'), -1);
  // Monatsgrenze darf nicht in die Hose gehen.
  assert.strictEqual(daysBack('2026-10-31', '2026-11-02'), 2);
  assert.strictEqual(daysBack('08.11.2026', '2026-11-10'), null);
  assert.strictEqual(daysBack('2026-11-08', ''), null);
});

test('heute ist kein Nachtrag, gestern schon', () => {
  assert.deepStrictEqual(writableDay('2026-11-10', '2026-11-10'), { ok: true, backfilled: false });
  assert.deepStrictEqual(writableDay('2026-11-09', '2026-11-10'), { ok: true, backfilled: true });
});

test('die Zukunft bleibt gesperrt', () => {
  assert.deepStrictEqual(writableDay('2026-11-11', '2026-11-10'), { ok: false, reason: 'future_day' });
});

test('der siebte Tag geht noch, der achte nicht', () => {
  assert.strictEqual(writableDay('2026-11-03', '2026-11-10').ok, true, 'Tag 7 muss erlaubt sein');
  const tooOld = writableDay('2026-11-02', '2026-11-10');
  assert.strictEqual(tooOld.ok, false);
  assert.strictEqual(tooOld.reason, 'too_old');
  assert.strictEqual(tooOld.maxDays, MAX_BACKFILL_DAYS);
});

test('kaputte Datumsangaben werden nicht stillschweigend gedeutet', () => {
  for (const bad of ['', null, undefined, '2026-11', '2026-13-01x', 'heute']) {
    assert.deepStrictEqual(writableDay(bad, '2026-11-10'), { ok: false, reason: 'invalid_date' }, String(bad));
  }
});

// ── Der Adapter: zwei Reihenformen, eine Bewertung ──────────────────────────

test('dayStart liefert den virtuellen Index von 00:00 — auch bei beschnittener Reihe', () => {
  assert.strictEqual(dayStart(fullDay(flat(10)).hourly, DATE), 0);
  // 09:00 steht auf Index 0, also liegt 00:00 virtuell auf -9.
  assert.strictEqual(dayStart(daylightOnly(flat(10)).hourly, DATE), -9);
  assert.strictEqual(dayStart(fullDay(flat(10)).hourly, '2026-11-09'), null, 'fremder Tag');
  assert.strictEqual(dayStart(null, DATE), null);
  assert.strictEqual(dayStart({ time: 'keine Liste' }, DATE), null);
});

test('Forecast-Volltag und ERA5-Tagesausschnitt ergeben dasselbe Ergebnis', () => {
  // Das ist der Kern des Entwurfs: ohne diesen Gleichstand wäre jeder
  // Soll/Ist-Vergleich ein Vergleich zweier verschiedener Rechenwege.
  const fromForecast = rateDay(fullDay(flat(10)), WIN, null, DATE);
  const fromHistory  = rateDay(daylightOnly(flat(10)), WIN, null, DATE);
  assert.deepStrictEqual(fromHistory, fromForecast);
  assert.deepStrictEqual(fromForecast, {
    date: DATE, score: 100, startHour: 9, endHour: 13, windKn: 19,
  });
});

// ── Tageswertung ────────────────────────────────────────────────────────────

test('rateDay trifft die Score-Bänder', () => {
  const score = v => rateDay(fullDay(flat(v)), WIN, null, DATE).score;
  assert.strictEqual(score(4), 27);    // unter minWind
  assert.strictEqual(score(7), 64);    // zwischen minWind und optMin
  assert.strictEqual(score(7.5), 76);
  assert.strictEqual(score(9), 100);   // im Optimum
  assert.strictEqual(score(14), 89);   // über optMax
  assert.strictEqual(score(18), 41);   // über maxWind
});

test('rateDay findet das beste Fenster, nicht das erste', () => {
  // Vormittag 4 m/s, ab 13 Uhr 10 m/s — die Session muss nach hinten rutschen.
  const entry = fullDay(h => (h >= 13 ? 10 : 4));
  assert.deepStrictEqual(rateDay(entry, WIN, null, DATE), {
    date: DATE, score: 100, startHour: 13, endHour: 17, windKn: 19,
  });
});

test('rateDay filtert NICHT auf Zukunft — anders als der Windalarm', () => {
  // spotDayScores in alerts.mjs verwirft vergangene Tage. Genau die will das
  // Logbuch bewerten; diese Zusicherung darf nicht versehentlich zurückwandern.
  const longAgo = rateDay(fullDay(flat(10)), WIN, null, DATE);
  assert.strictEqual(longAgo.score, 100, 'ein vergangener Tag muss bewertet werden');
});

test('rateDay zieht Offshore-Wind ab', () => {
  const offshore = fullDay(flat(10), flat(180));
  assert.strictEqual(rateDay(offshore, WIN, { offshoreDir: 180 }, DATE), null,
    'reiner Offshore-Tag darf keine Session liefern');
  assert.strictEqual(rateDay(offshore, WIN, { offshoreDir: 0 }, DATE).score, 100,
    'ohne Offshore-Treffer bleibt der Score voll');
});

test('rateDay gibt null statt einer erfundenen Null', () => {
  assert.strictEqual(rateDay(null, WIN, null, DATE), null);
  assert.strictEqual(rateDay({ hourly: { time: [] } }, WIN, null, DATE), null);
  assert.strictEqual(rateDay(fullDay(flat(10)), WIN, null, '2026-01-01'), null, 'Tag nicht in der Reihe');
  assert.strictEqual(rateDay(fullDay(flat(0)), WIN, null, DATE), null, 'Flaute ist keine Session');
});

// ── Soll gegen Ist ──────────────────────────────────────────────────────────

test('kleine Abweichungen gelten als getroffen', () => {
  const r = matchReport({ score: 84, windKn: 18 }, { score: 80, windKn: 17 });
  assert.deepStrictEqual(r, { deltaScore: -4, deltaWindKn: -1, verdict: 'getroffen', tolerance: MATCH_TOLERANCE });
});

test('die Toleranzgrenze liegt genau auf 8 Punkten', () => {
  assert.strictEqual(matchReport({ score: 80 }, { score: 72 }).verdict, 'getroffen', '8 ist noch drin');
  assert.strictEqual(matchReport({ score: 80 }, { score: 71 }).verdict, 'zu optimistisch', '9 nicht mehr');
});

test('das Urteil benennt die Richtung', () => {
  assert.strictEqual(matchReport({ score: 84 }, { score: 60 }).verdict, 'zu optimistisch');
  assert.strictEqual(matchReport({ score: 60 }, { score: 84 }).verdict, 'zu pessimistisch');
});

test('fehlt eine Seite, gibt es kein Urteil', () => {
  assert.strictEqual(matchReport(null, { score: 80 }), null);
  assert.strictEqual(matchReport({ score: 80 }, null), null);
  assert.strictEqual(matchReport({ score: null }, { score: 80 }), null);
  // Fehlender Wind darf das Score-Urteil nicht verhindern.
  const r = matchReport({ score: 80 }, { score: 78 });
  assert.strictEqual(r.deltaWindKn, null);
  assert.strictEqual(r.verdict, 'getroffen');
});

// ── Der Logbucheintrag ──────────────────────────────────────────────────────

const SPOTS = { s_stintino: { name: 'Stintino', emoji: '🏖️', offshoreDir: null } };

function entryFor(session, { forecastWind = 7.5, historyWind = 10 } = {}) {
  return logEntry({
    session,
    forecast: { spots: { s_stintino: fullDay(flat(forecastWind)) } },
    history: { spots: { s_stintino: daylightOnly(flat(historyWind)) } },
    spots: SPOTS, win: WIN,
  });
}

test('der gespeicherte Snapshot schlägt den laufenden Forecast', () => {
  // Nur der Snapshot hält fest, was VOR der Session vorhergesagt war.
  const e = entryFor({
    spot_id: 's_stintino', session_date: DATE,
    predicted_score: 55, predicted_wind_kt: 12,
    predicted_window_start: `${DATE}T10:00:00Z`, predicted_window_end: `${DATE}T14:00:00Z`,
  });
  assert.strictEqual(e.predicted.source, 'snapshot');
  assert.strictEqual(e.predicted.score, 55);
  assert.strictEqual(e.predicted.startHour, 10);
  assert.strictEqual(e.predicted.endHour, 14);
  // Ist kommt aus ERA5 (10 m/s → 100), Soll war 55 → deutlich zu pessimistisch.
  assert.strictEqual(e.actual.source, 'era5');
  assert.strictEqual(e.actual.score, 100);
  assert.strictEqual(e.match.verdict, 'zu pessimistisch');
});

test('ohne Snapshot dient der laufende Forecast als Rückfall', () => {
  const e = entryFor({ spot_id: 's_stintino', session_date: DATE, predicted_score: null });
  assert.strictEqual(e.predicted.source, 'forecast');
  assert.strictEqual(e.predicted.score, 76, '7.5 m/s');
  assert.strictEqual(e.actual.score, 100, '10 m/s');
  assert.strictEqual(e.match.deltaScore, 24);
  assert.strictEqual(e.match.verdict, 'zu pessimistisch');
});

test('fehlt die History, bleibt das Ist leer statt geraten', () => {
  const e = logEntry({
    session: { spot_id: 's_stintino', session_date: DATE, predicted_score: 80 },
    forecast: { spots: { s_stintino: fullDay(flat(10)) } },
    history: { spots: {} },
    spots: SPOTS, win: WIN,
  });
  assert.strictEqual(e.actual, null);
  assert.strictEqual(e.match, null, 'ohne Ist darf kein Urteil entstehen');
  assert.strictEqual(e.predicted.score, 80);
});

test('ein unbekannter Spot kippt den Eintrag nicht', () => {
  const e = logEntry({
    session: { spot_id: 's_gibt_es_nicht', session_date: DATE },
    forecast: { spots: {} }, history: { spots: {} }, spots: SPOTS, win: WIN,
  });
  assert.strictEqual(e.spot, null);
  assert.strictEqual(e.predicted, null);
  assert.strictEqual(e.actual, null);
  assert.strictEqual(e.match, null);
  assert.strictEqual(e.date, DATE);
});
