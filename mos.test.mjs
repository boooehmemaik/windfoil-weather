/**
 * mos.test.mjs
 * Stufe 3 — MOS (Model Output Statistics): gelernte Stunden-Bias-Korrektur.
 *
 * Ansatz: better-sqlite3 :memory: mit den Migrationen 006/007, dann die reinen
 * Funktionen aus src/mos.mjs asserten. Die Netzwerkschicht wird über den
 * fetchImpl-Parameter injiziert — kein Test hier geht ins Netz.
 *
 * Die vier Abnahmekriterien aus dem Plan haben je einen eigenen Test:
 *   (a) n_samples zählt TAGE, nicht Roh-Polls
 *   (b) ein negativer Bias bleibt negativ (Talamone 18 h)
 *   (c) |bias_shrunk_ms| < |bias_ms|
 *   (d) n < MOS_MIN_SAMPLES ⇒ bias_shrunk_ms === 0
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOS_MODEL_KEY, MOS_MIN_SAMPLES, MOS_SHRINK_K, MOS_CLAMP_MS,
  ensembleApi, median, mad, shrinkBias,
  getObsEpoch, markObsEpoch, localPartsTZ,
  rollupObsHourly, fetchHistoricalEnsemble, computeMosBias, runMosJob, getMosBias,
} from './src/mos.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = (f) => readFileSync(join(__dirname, 'db', 'migrations', f), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(MIG('006_station_obs.sql'));
  db.exec(MIG('007_station_mos_bias.sql'));
  return db;
}

const TORBOLE = { key: 'torbole', lat: 45.869, lon: 10.873, tz: 'Europe/Rome' };

// ── Statistik ────────────────────────────────────────────────────────────────

test('median: ungerade, gerade, mit NULL-Löchern', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([2, null, 4, undefined, NaN]), 3);
  assert.equal(median([]), null);
});

test('mad ist robust gegen einen einzelnen Ausreisser', () => {
  // Ein Wert 100× daneben darf die Streuungsschätzung nicht mitreissen —
  // genau der Fall "Sensor liefert eine Sekunde lang Müll".
  assert.equal(mad([1, 1, 1, 1, 1]), 0);
  assert.equal(mad([1, 2, 3, 4, 500]), 1);
});

// ── shrinkBias: Abnahmekriterien (c) und (d) ─────────────────────────────────

test('(d) unter MOS_MIN_SAMPLES ist der geschrumpfte Bias exakt 0', () => {
  for (let n = 0; n < MOS_MIN_SAMPLES; n++) {
    assert.equal(shrinkBias(2.5, n), 0, `n=${n}`);
    assert.equal(shrinkBias(-2.5, n), 0, `n=${n}`);
  }
  assert.notEqual(shrinkBias(2.5, MOS_MIN_SAMPLES), 0);
});

test('(c) Schrumpfung verkleinert den Betrag und behält das Vorzeichen', () => {
  for (const n of [8, 13, 30, 100]) {
    for (const b of [2.0, -2.0, 0.4, -0.4]) {
      const s = shrinkBias(b, n);
      assert.ok(Math.abs(s) < Math.abs(b), `n=${n} b=${b} → ${s}`);
      assert.ok(Math.sign(s) === Math.sign(b), `Vorzeichen n=${n} b=${b}`);
    }
  }
  // Der Faktor ist n/(n+K), nicht handgesetzt.
  assert.equal(shrinkBias(2, 10), 2 * (10 / (10 + MOS_SHRINK_K)));
});

test('shrinkBias klemmt symmetrisch bei MOS_CLAMP_MS', () => {
  assert.equal(shrinkBias(100, 10_000), MOS_CLAMP_MS);
  assert.equal(shrinkBias(-100, 10_000), -MOS_CLAMP_MS);
});

// ── Epoche ───────────────────────────────────────────────────────────────────

test('Epoche: leer bis der gefixte Poller sie setzt, danach unveränderlich', () => {
  const db = buildDb();
  assert.equal(getObsEpoch(db), null);

  const first = markObsEpoch(db, '2026-08-20T10:00:00.000Z');
  assert.equal(first, '2026-08-20T10:00:00.000Z');

  // Jeder spätere Poll ruft dasselbe auf. Würde er überschreiben, wanderte die
  // Epoche mit jedem Lauf nach vorn und der Job sähe nie genug Historie.
  markObsEpoch(db, '2026-08-21T10:00:00.000Z');
  assert.equal(getObsEpoch(db), '2026-08-20T10:00:00.000Z');
  db.close();
});

// ── Zeitzonen ────────────────────────────────────────────────────────────────

test('localPartsTZ liefert die Stationsstunde, nicht die UTC-Stunde', () => {
  // Der Bug, den Stufe 0 behoben hat, in einer Assertion: 12:00Z ist in Rom
  // während der Sommerzeit 14:00 lokal.
  const s = localPartsTZ(Date.parse('2026-08-20T12:00:00Z'), 'Europe/Rome');
  assert.deepEqual(s, { day: '2026-08-20', hour: 14 });

  // Winterzeit: derselbe UTC-Stundenwert, anderer Offset.
  const w = localPartsTZ(Date.parse('2026-01-20T12:00:00Z'), 'Europe/Rome');
  assert.deepEqual(w, { day: '2026-01-20', hour: 13 });

  // Tageswechsel: 23:30Z ist in Rom schon der nächste Tag.
  const n = localPartsTZ(Date.parse('2026-08-20T23:30:00Z'), 'Europe/Rome');
  assert.deepEqual(n, { day: '2026-08-21', hour: 1 });
});

// ── Rollup ───────────────────────────────────────────────────────────────────

function seedRawPolls(db, { day = '2026-08-21', hoursUTC = [12], perHour = 6, wind = 5 } = {}) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO station_obs (station_key, ts, wind_ms, gust_ms, lat, lon)
     VALUES (?,?,?,?,?,?)`);
  for (const h of hoursUTC) {
    for (let i = 0; i < perHour; i++) {
      const mm = String(i * 10).padStart(2, '0');
      ins.run('torbole', `${day}T${String(h).padStart(2, '0')}:${mm}:00.000Z`,
              wind, wind + 2, TORBOLE.lat, TORBOLE.lon);
    }
  }
}

test('(a) Rollup kollabiert die 6 Polls einer Stunde zu EINEM Sample', () => {
  const db = buildDb();
  markObsEpoch(db, '2026-08-20T00:00:00.000Z');
  seedRawPolls(db, { hoursUTC: [12], perHour: 6, wind: 6.19 });

  const r = rollupObsHourly(db, [TORBOLE]);
  assert.equal(r.ok, true);

  const rows = db.prepare('SELECT * FROM station_obs_hourly').all();
  assert.equal(rows.length, 1, 'sechs Rohzeilen → eine Stundenzeile');
  assert.equal(rows[0].n_raw, 6, 'n_raw hält den Unterschied nachprüfbar');
  assert.equal(rows[0].wind_ms, 6.19);
  assert.equal(rows[0].hour_local, 14, 'lokale Stunde (Rom, Sommerzeit), nicht 12');
  db.close();
});

test('Rollup ignoriert Zeilen vor der Epoche', () => {
  const db = buildDb();
  markObsEpoch(db, '2026-08-20T00:00:00.000Z');
  seedRawPolls(db, { day: '2026-08-18', hoursUTC: [12] }); // alte, phasenverschobene Semantik
  seedRawPolls(db, { day: '2026-08-21', hoursUTC: [12] });

  rollupObsHourly(db, [TORBOLE]);
  const days = db.prepare('SELECT DISTINCT local_day FROM station_obs_hourly').all().map(r => r.local_day);
  assert.deepEqual(days, ['2026-08-21']);
  db.close();
});

test('Rollup ist idempotent und überspringt Stationen ohne Zeitzone', () => {
  const db = buildDb();
  markObsEpoch(db, '2026-08-20T00:00:00.000Z');
  seedRawPolls(db, { hoursUTC: [10, 12, 14] });

  rollupObsHourly(db, [TORBOLE]);
  const after1 = db.prepare('SELECT count(*) c FROM station_obs_hourly').get().c;
  rollupObsHourly(db, [TORBOLE]);
  const after2 = db.prepare('SELECT count(*) c FROM station_obs_hourly').get().c;
  assert.equal(after1, 3);
  assert.equal(after2, 3, 'zweiter Lauf darf nicht duplizieren');

  // Ohne tz ist "lokale Stunde" undefiniert — lieber gar nichts als falsch.
  rollupObsHourly(db, [{ key: 'torbole', lat: 0, lon: 0 }]);
  assert.equal(db.prepare('SELECT count(*) c FROM station_obs_hourly').get().c, 3);
  db.close();
});

test('Rollup ohne Epoche verweigert die Arbeit', () => {
  const db = buildDb();
  seedRawPolls(db);
  const r = rollupObsHourly(db, [TORBOLE]);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_obs_epoch');
  assert.equal(db.prepare('SELECT count(*) c FROM station_obs_hourly').get().c, 0);
  db.close();
});

// ── Bias ─────────────────────────────────────────────────────────────────────

function obsSeries(hour, values, startDay = 1) {
  return values.map((v, i) => ({
    local_day: `2026-08-${String(startDay + i).padStart(2, '0')}`,
    hour_local: hour, wind_ms: v,
  }));
}
function predMap(hour, values, startDay = 1) {
  const m = new Map();
  values.forEach((v, i) => m.set(`2026-08-${String(startDay + i).padStart(2, '0')}|${hour}`, v));
  return m;
}

test('(b) ein negativer Bias bleibt negativ (Talamone 18 h)', () => {
  // Das Modell verspricht abends 6 m/s, gemessen werden 5.3 — raise-only
  // Korrekturen können diesen Fall strukturell nicht abbilden.
  const obs  = obsSeries(18, [5.3, 5.1, 5.4, 5.2, 5.3, 5.0, 5.5, 5.2, 5.3, 5.1]);
  const pred = predMap(18, new Array(10).fill(6.0));
  const rows = computeMosBias(obs, pred);
  const h18 = rows.find(r => r.hour_local === 18);

  assert.equal(h18.n_samples, 10);
  assert.ok(h18.bias_ms < 0, `erwartet negativ, war ${h18.bias_ms}`);
  assert.ok(h18.bias_shrunk_ms < 0);
  assert.ok(Math.abs(h18.bias_shrunk_ms) < Math.abs(h18.bias_ms));
});

test('computeMosBias schreibt alle 24 Stunden, auch die ohne Daten', () => {
  const rows = computeMosBias(obsSeries(14, [5, 6, 5.5]), predMap(14, [4, 4, 4]));
  assert.equal(rows.length, 24);
  assert.deepEqual(rows.map(r => r.hour_local), [...Array(24).keys()]);

  // Die UI braucht n, um "lernt noch, 3/8 Tage" sagen zu können statt zu schweigen.
  const h14 = rows[14];
  assert.equal(h14.n_samples, 3);
  assert.equal(h14.bias_shrunk_ms, 0, 'n=3 < MIN ⇒ keine Wirkung');
  assert.ok(h14.bias_ms > 0, 'der rohe Bias wird trotzdem berichtet');

  const h3 = rows[3];
  assert.equal(h3.n_samples, 0);
  assert.equal(h3.bias_ms, 0);
  assert.equal(h3.mad_ms, null);
});

test('computeMosBias paart nur Tage mit BEIDEN Werten', () => {
  const obs = obsSeries(12, [5, 6, 7, 8]);
  const pred = predMap(12, [4, 5]);          // nur die ersten beiden Tage
  const rows = computeMosBias(obs, pred);
  assert.equal(rows[12].n_samples, 2);
  assert.equal(rows[12].bias_ms, 1);
});

test('Median statt Mittel: ein Ausreisser-Tag kippt den Bias nicht', () => {
  const obs  = obsSeries(12, [5, 5, 5, 5, 5, 5, 5, 5, 5, 40]);  // ein Sensorfehler
  const pred = predMap(12, new Array(10).fill(4));
  const rows = computeMosBias(obs, pred);
  assert.equal(rows[12].bias_ms, 1, 'Median bleibt bei 1.0; ein Mittel läge bei 4.5');
});

// ── Historische Vorhersage (fetch injiziert) ─────────────────────────────────

function fakeHistoricalResponse(days, hourValue) {
  const time = [], per = {};
  const models = ['meteofrance_arome_france_hd', ...ensembleApi().ENS_CORE];
  for (const m of models) per[`windspeed_10m_${m}`] = [];
  for (const d of days) {
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      models.forEach((m, mi) => per[`windspeed_10m_${m}`].push(hourValue(d, h, mi)));
    }
  }
  return { hourly: { time, ...per } };
}

test('fetchHistoricalEnsemble: lokale Zeitachse, kein Offset-Rechnen im Pairing', async () => {
  let seenUrl = null;
  const days = ['2026-08-18', '2026-08-19'];
  const fake = async (url) => {
    seenUrl = url;
    return { json: async () => fakeHistoricalResponse(days, (_d, h) => h) };
  };

  const { byKey, members } = await fetchHistoricalEnsemble(TORBOLE, days[0], days[1], fake);

  assert.ok(seenUrl.includes('historical-forecast-api.open-meteo.com'));
  assert.ok(seenUrl.includes('timezone=Europe%2FRome'), 'timezone muss die Stations-TZ sein');
  assert.ok(seenUrl.includes('meteofrance_arome_france_hd'), 'Torbole liegt in der AROME-Domain');
  assert.equal(members.length, 6);

  // Alle Member liefern denselben Wert h ⇒ Median = h. Der Schlüssel ist die
  // lokale Stunde direkt aus dem Zeitstring — keine Umrechnung dazwischen.
  assert.equal(byKey.get('2026-08-18|14'), 14);
  assert.equal(byKey.size, 48);
});

test('fetchHistoricalEnsemble: ausserhalb der AROME-Domain nur die Kern-Member', async () => {
  let seenUrl = null;
  const VASILIKI = { key: 'LGPZ', lat: 38.9254, lon: 20.7653, tz: 'Europe/Athens' };
  const fake = async (url) => {
    seenUrl = url;
    // AROME fehlt im Response KOMPLETT (kein null-gefülltes Array) — so verhält
    // sich die echte API ausserhalb der Domain.
    const r = fakeHistoricalResponse(['2026-08-18'], (_d, h) => h);
    delete r.hourly['windspeed_10m_meteofrance_arome_france_hd'];
    return { json: async () => r };
  };
  const { members } = await fetchHistoricalEnsemble(VASILIKI, '2026-08-18', '2026-08-18', fake);
  assert.ok(!seenUrl.includes('arome'), 'AROME wird gar nicht erst angefragt');
  assert.ok(!members.includes('meteofrance_arome_france_hd'));
  assert.equal(members.length, 5);
});

test('fetchHistoricalEnsemble meldet einen leeren Response als Fehler', async () => {
  const fake = async () => ({ json: async () => ({ reason: 'Invalid date' }) });
  await assert.rejects(
    () => fetchHistoricalEnsemble(TORBOLE, '2026-08-18', '2026-08-18', fake),
    /Invalid date/);
});

// ── Job end-to-end ───────────────────────────────────────────────────────────

test('runMosJob ohne Epoche lehnt ab statt Müll zu lernen', async () => {
  const db = buildDb();
  const out = await runMosJob(db, [TORBOLE], { fetchImpl: async () => { throw new Error('darf nicht aufgerufen werden'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /no_obs_epoch/);
  db.close();
});

test('runMosJob: Rollup → Paarung → station_mos_bias', async () => {
  const db = buildDb();
  markObsEpoch(db, '2026-08-01T00:00:00.000Z');

  // 12 Tage × 6 Polls je Stunde, lokal 14:00 (= 12:00Z im Sommer).
  // Beobachtet 8 m/s, Modell sagt 5 m/s ⇒ erwarteter Bias +3.0.
  const days = [];
  for (let d = 1; d <= 12; d++) {
    const day = `2026-08-${String(d).padStart(2, '0')}`;
    days.push(day);
    seedRawPolls(db, { day, hoursUTC: [12], perHour: 6, wind: 8 });
  }

  // endDay explizit: sonst hinge der Test am Systemdatum und schlüge irgendwann
  // aus einem Grund fehl, der nichts mit MOS zu tun hat.
  const fake = async () => ({ json: async () => fakeHistoricalResponse(days, () => 5) });
  const out = await runMosJob(db, [TORBOLE], { fetchImpl: fake, endDay: '2026-08-12' });

  assert.equal(out.ok, true);
  const r = out.results.find(x => x.station === 'torbole');
  assert.equal(r.ok, true, r.error);

  // (a) n zählt Tage, nicht Roh-Polls. Bei 72 hätte der Rollup nicht kollabiert
  //     und jeder nachgelagerte Shrinkage-Guard wäre wirkungslos.
  assert.equal(r.maxN, 12, `n_samples war ${r.maxN}`);
  assert.ok(r.maxN < 20, 'Roh-Polls dürfen niemals als Samples durchgehen');

  const row = db.prepare(
    `SELECT * FROM station_mos_bias WHERE station_key='torbole' AND hour_local=14 AND model_key=?`
  ).get(MOS_MODEL_KEY);
  assert.equal(row.n_samples, 12);
  assert.equal(row.bias_ms, 3);
  assert.equal(row.obs_median_ms, 8);
  assert.equal(row.pred_median_ms, 5);
  assert.equal(row.mad_ms, 0, 'jeden Tag derselbe Bias ⇒ keine Streuung');
  // (c)
  assert.ok(Math.abs(row.bias_shrunk_ms) < Math.abs(row.bias_ms));
  assert.equal(row.bias_shrunk_ms, Math.round(3 * (12 / 22) * 100) / 100);
  assert.deepEqual(JSON.parse(row.members).length, 6);

  // Stunden ohne Daten stehen trotzdem in der Tabelle, mit n=0 und Wirkung 0.
  const idle = db.prepare(
    `SELECT * FROM station_mos_bias WHERE station_key='torbole' AND hour_local=3`).get();
  assert.equal(idle.n_samples, 0);
  assert.equal(idle.bias_shrunk_ms, 0);

  // Zweiter Lauf überschreibt, statt zu duplizieren.
  await runMosJob(db, [TORBOLE], { fetchImpl: fake, endDay: '2026-08-12' });
  assert.equal(db.prepare(
    `SELECT count(*) c FROM station_mos_bias WHERE station_key='torbole'`).get().c, 24);
  db.close();
});

test('runMosJob lernt nicht aus dem unfertigen heutigen Tag', async () => {
  // Alle Beobachtungen liegen NACH dem Fensterende (typisch am ersten Tag nach
  // dem Deploy). Die Historical-API kennt heute noch nicht zuverlässig — lieber
  // eine Runde aussetzen als einen Bias aus einem halben Tag lernen.
  const db = buildDb();
  markObsEpoch(db, '2026-08-01T00:00:00.000Z');
  seedRawPolls(db, { day: '2026-08-20', hoursUTC: [12], wind: 8 });

  const out = await runMosJob(db, [TORBOLE], {
    fetchImpl: async () => { throw new Error('darf nicht aufgerufen werden'); },
    endDay: '2026-08-19',
  });
  assert.equal(out.results[0].error, 'window_empty');
  assert.equal(db.prepare('SELECT count(*) c FROM station_mos_bias').get().c, 0);
  db.close();
});

test('runMosJob übersteht eine kaputte Station, ohne die anderen zu verlieren', async () => {
  const db = buildDb();
  markObsEpoch(db, '2026-08-01T00:00:00.000Z');
  seedRawPolls(db, { day: '2026-08-02', hoursUTC: [12], wind: 8 });

  const out = await runMosJob(db, [
    { key: 'kaputt', lat: 0, lon: 0 },                    // kein tz
    { key: 'leer', lat: 1, lon: 1, tz: 'Europe/Rome' },   // keine Beobachtungen
    TORBOLE,
  ], { fetchImpl: async () => ({ json: async () => fakeHistoricalResponse(['2026-08-02'], () => 5) }),
       endDay: '2026-08-02' });

  assert.equal(out.ok, true);
  assert.equal(out.results.find(r => r.station === 'kaputt').error, 'no_tz');
  assert.equal(out.results.find(r => r.station === 'leer').error, 'no_obs');
  assert.equal(out.results.find(r => r.station === 'torbole').ok, true);
  db.close();
});

// ── Lesezugriff ──────────────────────────────────────────────────────────────

test('getMosBias liefert 24 Slots und null für unbekannte Stationen', async () => {
  const db = buildDb();
  assert.equal(getMosBias(db, 'torbole'), null);

  markObsEpoch(db, '2026-08-01T00:00:00.000Z');
  seedRawPolls(db, { day: '2026-08-02', hoursUTC: [12], wind: 8 });
  await runMosJob(db, [TORBOLE], {
    fetchImpl: async () => ({ json: async () => fakeHistoricalResponse(['2026-08-02'], () => 5) }),
    endDay: '2026-08-02',
  });

  const m = getMosBias(db, 'torbole');
  assert.equal(m.hours.length, 24);
  assert.equal(m.modelKey, MOS_MODEL_KEY);
  assert.equal(m.minSamples, MOS_MIN_SAMPLES);
  assert.equal(m.hours[14].n, 1);
  assert.equal(m.hours[14].biasShrunkMs, 0, 'ein Tag reicht nicht');
  assert.equal(getMosBias(db, 'gibtsnicht'), null);
  db.close();
});

// ── Kopplung an das Frontend ─────────────────────────────────────────────────

test('ensembleApi zieht denselben Sentinel-Block, den das Frontend ausführt', () => {
  const api = ensembleApi();
  assert.ok(Array.isArray(api.ENS_CORE) && api.ENS_CORE.length === 5);
  assert.equal(typeof api.combineEnsemble, 'function');

  // Der Bias ist nur die richtige Korrektur, wenn "Ensemble-Median" hier exakt
  // dasselbe meint wie in der App. Eine Mini-Rechnung als Kanarienvogel:
  const hourly = { time: ['2026-08-18T00:00'] };
  api.ENS_CORE.forEach((m, i) => { hourly[`windspeed_10m_${m}`] = [i + 1]; });
  assert.equal(api.combineEnsemble(hourly, api.ENS_CORE).wind[0], 3);
});
