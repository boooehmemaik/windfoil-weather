// ============================================================================
// WindFoil — MOS (Model Output Statistics): gelernte Stunden-Bias-Korrektur
// File version: 1.0.0 (ESM .mjs)  |  App target: v3.22.0
// ----------------------------------------------------------------------------
// Idee in einem Satz: für jede Station und jede lokale Stunde messen, wie weit
// der Ensemble-Median systematisch neben der Beobachtung liegt, und diese
// Differenz später auf den Forecast anwenden.
//
// Warum das die bestehenden Heuristiken schlägt: seaBreeze(), applyPelerBoost()
// und die arome_best_max-Hüllkurve sind alle RAISE-ONLY. Der gemessene Bias
// wechselt aber das Vorzeichen — an Talamone abends verspricht das Modell Wind,
// der nicht kommt. Eine Korrektur, die nur anheben kann, verschlimmert das.
//
// Bewusst NICHT gebaut: vorlaufzeitabhängiges MOS. Technisch verfügbar, aber
// ~13 Tagessamples auf 7 Vorlauf-Buckets ergäbe n≈2 je Bucket. Der hier
// gelernte Bias ist ein KURZFRIST-Bias, der auf alle 7 Tage angewendet wird —
// eine Näherung, die mit der Vorlaufzeit schlechter wird. Das Schema ist
// vorbereitet (model_key im PK, lead_day nachrüstbar).
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MOS_MODEL_KEY   = 'ens_median_v1';
export const MOS_MIN_SAMPLES = 8;    // darunter wird bias_shrunk_ms auf 0 gehalten
export const MOS_SHRINK_K    = 10;   // Empirical-Bayes: bias * n/(n+K)
export const MOS_CLAMP_MS    = 3.0;  // harte Grenze gegen Ausreisser-Bias
export const MOS_LOOKBACK_D  = 60;   // wie weit zurück Beobachtungen gepaart werden

// ── Ensemble-Code aus index.html ziehen ─────────────────────────────────────
// Der MOS-Bias ist als median(obs − ensembleMedian) definiert. Er ist NUR dann
// die richtige Korrektur, wenn "ensembleMedian" hier bitgenau dasselbe meint
// wie im Frontend. Eine zweite Implementierung wäre eine Divergenz, die
// niemandem auffällt, bis die Korrektur in die falsche Richtung zieht.
// Deshalb wird derselbe Sentinel-Block ausgeführt, den auch ensemble.test.mjs
// prüft — dieselbe Technik, gleiche Quelle, keine Kopie.
let _ens = null;
export function ensembleApi(indexPath = join(__dirname, '..', 'index.html')) {
  if (_ens) return _ens;
  const html = readFileSync(indexPath, 'utf8');
  const s = '// <<ensemble>>', e = '// <</ensemble>>';
  const a = html.indexOf(s), b = html.indexOf(e);
  if (a === -1 || b === -1 || a > b) throw new Error('ensemble sentinel block not found in index.html');
  const ctx = vm.createContext({ console, pickForecastModel: () => '' });
  _ens = vm.runInContext(
    `${html.slice(a + s.length, b)}
     ;({ ensembleMembers, admitMembers, quantile, median, combineEnsemble, ENS_CORE })`,
    ctx);
  return _ens;
}

// ── Statistik ───────────────────────────────────────────────────────────────
// Median und MAD, nicht Mittel und Standardabweichung: bei 12-14 Samples reicht
// ein einzelner Böenausreisser oder eine Stunde Sensorausfall, um ein Mittel
// mehrere m/s zu verschieben.
export function median(xs) {
  const a = xs.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
export function mad(xs, center) {
  const m = center ?? median(xs);
  if (m == null) return null;
  return median(xs.filter(Number.isFinite).map(v => Math.abs(v - m)));
}
const r2 = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Zwei unabhängige Dämpfungen, absichtlich:
//   hier    schützt den WERT   (wenig Daten ⇒ Bias gegen 0)
//   Client  steuert die ÜBERGABE (Distanz zur Station, Vertrauen)
// Bei n=13 ergibt das serverseitig 13/23 = 0.57. Wer beide Faktoren ändert,
// muss wissen, dass sie sich multiplizieren.
export function shrinkBias(bias, n) {
  if (bias == null || n < MOS_MIN_SAMPLES) return 0;
  return clamp(bias * (n / (n + MOS_SHRINK_K)), -MOS_CLAMP_MS, MOS_CLAMP_MS);
}

// ── Epoche ──────────────────────────────────────────────────────────────────
// Vor dieser Marke sind station_obs-Zeitstempel um den UTC-Offset verschoben
// (lokale Stundenwerte unter UTC-Index abgelegt). Siehe Migration 007.
export function getObsEpoch(db) {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key='mos_obs_epoch'`).get();
  return row ? row.value : null;
}
export function markObsEpoch(db, iso = new Date().toISOString()) {
  db.prepare(`INSERT OR IGNORE INTO app_meta(key, value, updated_at) VALUES ('mos_obs_epoch', ?, ?)`)
    .run(iso, new Date().toISOString());
  return getObsEpoch(db);
}

// ── Rollup: Rohpolls → ein Sample je (Station, lokaler Tag, lokale Stunde) ──
export function localPartsTZ(epochMs, tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date(epochMs)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { day: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24 };
}

export function rollupObsHourly(db, stations, { sinceIso = null } = {}) {
  const epoch = sinceIso ?? getObsEpoch(db);
  if (!epoch) return { ok: false, error: 'no_obs_epoch', rows: 0 };

  const upsert = db.prepare(`
    INSERT INTO station_obs_hourly (station_key, local_day, hour_local, wind_ms, gust_ms, n_raw)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(station_key, local_day, hour_local) DO UPDATE SET
      wind_ms = excluded.wind_ms, gust_ms = excluded.gust_ms, n_raw = excluded.n_raw`);

  let written = 0;
  const tx = db.transaction(() => {
    for (const st of stations) {
      if (!st.tz) continue;   // ohne Zeitzone ist "lokale Stunde" nicht definiert

      // Die Epoche gilt nur für Stationen, die vom Phasenfehler betroffen WAREN.
      // Der Fehler steckte im MEASURED_STATIONS-Zweig, der eine lokal befüllte
      // Tagesserie mit der UTC-Stunde indizierte. LIVE_STATIONS holen dagegen
      // einen Momentanwert und legen ihn unter dem echten Poll-Zeitstempel ab —
      // da gibt es keine Stunde, die falsch sein könnte, und ihre Historie ist
      // rückwirkend gültig. Sie pauschal mit zu verwerfen hiesse, Talamones 14
      // brauchbare Tage wegzuwerfen und acht Tage auf etwas zu warten, das schon
      // in der Datenbank steht.
      const cutoff = st.obsPreFixValid ? "" : epoch;
      const rows = db.prepare(
        `SELECT ts, wind_ms, gust_ms FROM station_obs WHERE station_key=? AND ts>=? ORDER BY ts`
      ).all(st.key, cutoff);

      // Bucket-Schlüssel ist die STATIONSLOKALE Stunde, nicht die UTC-Stunde.
      const buckets = new Map();
      for (const r of rows) {
        const { day, hour } = localPartsTZ(Date.parse(r.ts), st.tz);
        const k = `${day}|${hour}`;
        if (!buckets.has(k)) buckets.set(k, { day, hour, w: [], g: [] });
        const b = buckets.get(k);
        if (Number.isFinite(r.wind_ms)) b.w.push(r.wind_ms);
        if (Number.isFinite(r.gust_ms)) b.g.push(r.gust_ms);
      }
      for (const b of buckets.values()) {
        if (!b.w.length) continue;
        upsert.run(st.key, b.day, b.hour, r2(median(b.w)), r2(median(b.g)), b.w.length);
        written++;
      }
    }
  });
  tx();
  return { ok: true, rows: written };
}

// ── Historische Modellvorhersage ────────────────────────────────────────────
// historical-forecast-api liefert, was ein Modell damals VORHERGESAGT hat (nicht
// die Reanalyse). Mit timezone=<Stations-TZ> ist die Zeitachse bereits lokal und
// paart direkt mit hour_local — dadurch gibt es im Pairing keine
// Offset-Arithmetik, und damit auch nicht den Fehler, den Stufe 0 behoben hat.
export async function fetchHistoricalEnsemble(st, startDay, endDay, fetchImpl = fetch) {
  const api = ensembleApi();
  const members = st.lat >= 36 && st.lat <= 47.2 && st.lon >= 6.5 && st.lon <= 16
    ? ['meteofrance_arome_france_hd', ...api.ENS_CORE]
    : api.ENS_CORE.slice();
  const p = new URLSearchParams({
    latitude: st.lat, longitude: st.lon, start_date: startDay, end_date: endDay,
    hourly: 'windspeed_10m', wind_speed_unit: 'ms', timezone: st.tz,
    models: members.join(','),
  });
  const res = await fetchImpl(`https://historical-forecast-api.open-meteo.com/v1/forecast?${p}`);
  const j = await res.json();
  if (!j?.hourly?.time) throw new Error(j?.reason || 'historical_api_no_data');
  const ens = api.combineEnsemble(j.hourly, members);
  if (!ens) throw new Error('ensemble_not_combinable');

  // → Map 'YYYY-MM-DD|H' → Median. Zeitstring ist bereits lokal.
  const byKey = new Map();
  for (let i = 0; i < j.hourly.time.length; i++) {
    if (ens.wind[i] == null) continue;
    const t = j.hourly.time[i];
    byKey.set(`${t.slice(0, 10)}|${parseInt(t.slice(11, 13), 10)}`, ens.wind[i]);
  }
  return { byKey, members: ens.members, n: byKey.size };
}

// ── Bias je Stunde ──────────────────────────────────────────────────────────
export function computeMosBias(obsRows, predByKey) {
  const byHour = new Map();          // hour → [obs - pred]
  const obsByHour = new Map(), predByHour = new Map();
  let winStart = null, winEnd = null;

  for (const o of obsRows) {
    const pred = predByKey.get(`${o.local_day}|${o.hour_local}`);
    if (!Number.isFinite(pred) || !Number.isFinite(o.wind_ms)) continue;
    if (!byHour.has(o.hour_local)) { byHour.set(o.hour_local, []); obsByHour.set(o.hour_local, []); predByHour.set(o.hour_local, []); }
    byHour.get(o.hour_local).push(o.wind_ms - pred);
    obsByHour.get(o.hour_local).push(o.wind_ms);
    predByHour.get(o.hour_local).push(pred);
    if (!winStart || o.local_day < winStart) winStart = o.local_day;
    if (!winEnd   || o.local_day > winEnd)   winEnd   = o.local_day;
  }

  const out = [];
  for (let hour = 0; hour < 24; hour++) {
    const d = byHour.get(hour) || [];
    const b = median(d);
    // Zeile IMMER schreiben, auch bei zu wenigen Samples — die UI braucht n,
    // um "lernt noch, 5/8 Tage" anzeigen zu können statt einfach zu schweigen.
    out.push({
      hour_local: hour,
      n_samples: d.length,
      bias_ms: r2(b) ?? 0,
      bias_shrunk_ms: r2(shrinkBias(b, d.length)) ?? 0,
      mad_ms: r2(mad(d, b)),
      obs_median_ms: r2(median(obsByHour.get(hour) || [])),
      pred_median_ms: r2(median(predByHour.get(hour) || [])),
      window_start: winStart, window_end: winEnd,
    });
  }
  return out;
}

// ── Job ─────────────────────────────────────────────────────────────────────
export async function runMosJob(db, stations, {
  fetchImpl = fetch,
  lookbackDays = MOS_LOOKBACK_D,
  // Ende des Lernfensters. Default ist gestern (siehe unten); explizit setzbar,
  // damit Tests nicht am Systemdatum hängen.
  endDay = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
} = {}) {
  const epoch = getObsEpoch(db);
  if (!epoch) return { ok: false, error: 'no_obs_epoch — Poller mit Zeitzonen-Fix lief noch nie' };

  const roll = rollupObsHourly(db, stations);
  const upsert = db.prepare(`
    INSERT INTO station_mos_bias
      (station_key, hour_local, model_key, bias_ms, bias_shrunk_ms, mad_ms, n_samples,
       obs_median_ms, pred_median_ms, window_start, window_end, members, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(station_key, hour_local, model_key) DO UPDATE SET
      bias_ms=excluded.bias_ms, bias_shrunk_ms=excluded.bias_shrunk_ms,
      mad_ms=excluded.mad_ms, n_samples=excluded.n_samples,
      obs_median_ms=excluded.obs_median_ms, pred_median_ms=excluded.pred_median_ms,
      window_start=excluded.window_start, window_end=excluded.window_end,
      members=excluded.members, updated_at=excluded.updated_at`);

  const now = new Date();
  const results = [];
  for (const st of stations) {
    if (!st.tz) { results.push({ station: st.key, ok: false, error: 'no_tz' }); continue; }
    try {
      const obsRows = db.prepare(
        `SELECT local_day, hour_local, wind_ms FROM station_obs_hourly
         WHERE station_key=? ORDER BY local_day, hour_local`).all(st.key);
      if (!obsRows.length) { results.push({ station: st.key, ok: false, error: 'no_obs' }); continue; }

      // Fenster aus den vorhandenen Beobachtungen ableiten, aber gestern enden
      // lassen: der heutige Tag ist unvollständig und die Historical-API kennt
      // ihn noch nicht zuverlässig.
      const days = [...new Set(obsRows.map(r => r.local_day))].sort();
      const startDay = days[Math.max(0, days.length - lookbackDays)];
      if (startDay > endDay) { results.push({ station: st.key, ok: false, error: 'window_empty' }); continue; }

      const { byKey, members } = await fetchHistoricalEnsemble(st, startDay, endDay, fetchImpl);
      const rows = computeMosBias(obsRows.filter(r => r.local_day <= endDay), byKey);
      const memJson = JSON.stringify(members);
      const iso = now.toISOString();
      db.transaction(() => {
        for (const r of rows)
          upsert.run(st.key, r.hour_local, MOS_MODEL_KEY, r.bias_ms, r.bias_shrunk_ms,
                     r.mad_ms, r.n_samples, r.obs_median_ms, r.pred_median_ms,
                     r.window_start, r.window_end, memJson, iso);
      })();

      const usable = rows.filter(r => r.n_samples >= MOS_MIN_SAMPLES).length;
      results.push({ station: st.key, ok: true, hours: rows.length, usableHours: usable,
                     maxN: Math.max(...rows.map(r => r.n_samples)), window: [startDay, endDay] });
    } catch (e) {
      results.push({ station: st.key, ok: false, error: e.message });
    }
  }
  return { ok: true, epoch, rollup: roll, results };
}

// ── Lesezugriff für die Route ───────────────────────────────────────────────
export function getMosBias(db, stationKey, modelKey = MOS_MODEL_KEY) {
  const rows = db.prepare(`
    SELECT hour_local, bias_ms, bias_shrunk_ms, mad_ms, n_samples, window_start, window_end, updated_at
    FROM station_mos_bias WHERE station_key=? AND model_key=? ORDER BY hour_local`)
    .all(stationKey, modelKey);
  if (!rows.length) return null;
  const hours = new Array(24).fill(null);
  for (const r of rows) hours[r.hour_local] = {
    biasMs: r.bias_ms, biasShrunkMs: r.bias_shrunk_ms, madMs: r.mad_ms, n: r.n_samples,
  };
  return {
    stationKey, modelKey, hours,
    minSamples: MOS_MIN_SAMPLES,
    window: [rows[0].window_start, rows[0].window_end],
    updatedAt: rows[0].updated_at,
  };
}
