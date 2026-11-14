// ============================================================================
// WindFoil — Historischer ML-Backfill: Stationsbeobachtungen ↔ damalige Prognosen
// File version: 1.1.0  |  App target: v3.42.0
// ----------------------------------------------------------------------------
// Liefert sofort tausende Trainingspaare je Station statt Monate Live-Polling.
// Arbeitet in Monats-Chunks, die in ml_backfill_progress quittiert werden: ein
// Lauf, der am Open-Meteo-Tageslimit (429) stirbt, setzt beim nächsten Mal
// exakt am offenen Chunk fort, ohne bereits bezahlte Requests zu wiederholen.
// ============================================================================

import { gunzipSync } from 'node:zlib';
import { fetchHistoricalEnsemble, localPartsTZ } from './mos.mjs';

const KN_TO_MS = 0.514444;
const KMH_TO_MS = 1 / 3.6;
const MAX_ABS_BIAS = 15;
const HOUR_MS = 3600000;
// Meteostat lagt Wochen bis Monate: leere junge Monate dürfen nicht als 'done'
// gelten, sonst würden sie nie nachgeladen, sobald die Daten nachkommen.
const EMPTY_RETRY_DAYS = 180;
// previous-runs-api hat erst ab ~Anfang 2024 Daten; davor ist "leer" korrekt.
const PREV_RUNS_FROM = '2024-03';
// Anteil der TAGE mit ≥ 1 Obs. Stunden wären falsch: SYNOP-Stationen melden oft
// nur 3-stündlich (8/24) und wären sonst nie "vollständig".
const MIN_COVERAGE = 0.9;
// 'partial'/'error' nicht bei jedem Lauf erneut bezahlen — höchstens so oft.
const RETRY_PARTIAL_MS = 7 * 86400000;
const RETRY_ERROR_MS = 86400000;
const FETCH_TIMEOUT_MS = 30000;
// Open-Meteo-Tageskontingent teilt sich der Backfill mit den Nutzer-Forecasts
// derselben Server-IP — deshalb ein eigenes, konservatives Budget.
export const OM_DAILY_BUDGET = parseInt(process.env.ML_OM_DAILY_BUDGET || '4000', 10);

export class RateLimitError extends Error {
  constructor(url, reason = 'http_429') { super(`rate_limited (${reason}): ${url}`); this.name = 'RateLimitError'; this.reason = reason; }
}

const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const num = s => {
  if (s == null || s === '' || s === 'null' || s === 'M') return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};
const pad2 = n => String(n).padStart(2, '0');
const hourTs = ms => new Date(ms).toISOString().slice(0, 13) + ':00:00Z';
const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

// ── Parser (rein) ───────────────────────────────────────────────────────────
// Meteostat-Jahres-Dumps (data.meteostat.net/hourly/{year}/{id}.csv.gz):
// Header-Zeile, Spaltenreihenfolge NICHT garantiert, je Messgröße eine
// `<name>_source`-Spalte. Meteostat füllt Lücken mit Modelldaten (MOSMIX, Met.no …)
// — die würden einen Bias "Modell gegen Modell" lernen und werden verworfen.
const MODEL_SOURCE_RE = /model|mosmix|met\.?no|forecast|gfs|icon|ecmwf|nwp|era5|reanalys|synthetic/i;

export function isModelSource(src) {
  return src != null && src !== '' && MODEL_SOURCE_RE.test(String(src));
}

function colIndex(header) {
  const h = header.map(x => x.trim().toLowerCase());
  const at = name => h.indexOf(name);
  return {
    time: at('time'), date: at('date'), year: at('year'), month: at('month'), day: at('day'), hour: at('hour'),
    wspd: at('wspd'), wpgt: at('wpgt'), wdir: at('wdir'), src: at('wspd_source'),
  };
}

function rowTs(c, ix) {
  if (ix.time >= 0) {
    const t = Date.parse(c[ix.time].replace(' ', 'T') + (c[ix.time].length <= 19 ? 'Z' : ''));
    return Number.isFinite(t) ? hourTs(t) : null;
  }
  const day = ix.date >= 0 ? c[ix.date]
    : ix.year >= 0 ? `${c[ix.year]}-${pad2(+c[ix.month])}-${pad2(+c[ix.day])}` : null;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || ix.hour < 0) return null;
  return `${day}T${pad2(parseInt(c[ix.hour], 10))}:00:00Z`;
}

// sinceDay: nur das Backfill-Fenster in die Map; zeilenweise per indexOf statt
// split(), damit auf dem LXC kein zweites großes Array neben dem String entsteht.
// stats sammelt die gesehenen Quellen, damit der Filter in Produktion prüfbar ist.
export function parseMeteostatHourlyCsv(csv, { sinceDay = null, stats = null } = {}) {
  const out = new Map();
  const text = String(csv);
  let pos = 0, ix = null;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl).trim();
    pos = nl + 1;
    if (!line) continue;
    const c = line.split(',');
    if (!ix) {
      // Legacy-Format ohne Header (bulk.meteostat.net v2): date,hour,…,wdir(7),wspd(8),wpgt(9)
      if (/^\d{4}-\d{2}-\d{2}$/.test(c[0])) ix = { time: -1, date: 0, year: -1, hour: 1, wspd: 8, wpgt: 9, wdir: 7, src: -1 };
      else { ix = colIndex(c); continue; }
    }
    if (ix.wspd < 0) break;
    const ts = rowTs(c, ix);
    if (!ts || (sinceDay && ts.slice(0, 10) < sinceDay)) continue;
    const src = ix.src >= 0 ? c[ix.src] : null;
    if (stats) stats.set(src ?? '(none)', (stats.get(src ?? '(none)') || 0) + 1);
    if (isModelSource(src)) continue;
    const wind = num(c[ix.wspd]);
    if (wind == null) continue;
    const gust = ix.wpgt >= 0 ? num(c[ix.wpgt]) : null;
    out.set(ts, {
      wind_ms: r2(wind * KMH_TO_MS),
      gust_ms: gust == null ? null : r2(gust * KMH_TO_MS),
      dir_deg: ix.wdir >= 0 ? num(c[ix.wdir]) : null,
      source: 'meteostat',
    });
  }
  return out;
}

export function parseIemAsosCsv(csv) {
  const out = [];
  let ix = { valid: 1, sknt: 2, gust: 3, drct: 4 };
  for (const line of String(csv).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const c = line.trim().split(',');
    if (c[0] === 'station') {
      const h = c.map(x => x.trim());
      ix = { valid: h.indexOf('valid'), sknt: h.indexOf('sknt'), gust: h.indexOf('gust'), drct: h.indexOf('drct') };
      continue;
    }
    if (ix.valid < 0 || ix.sknt < 0 || c.length <= ix.sknt) continue;
    const t = Date.parse(`${c[ix.valid].replace(' ', 'T')}:00Z`);
    const sknt = num(c[ix.sknt]);
    if (!Number.isFinite(t) || sknt == null) continue;
    const gust = ix.gust >= 0 ? num(c[ix.gust]) : null;
    out.push({
      t,
      wind_ms: r2(sknt * KN_TO_MS),
      gust_ms: gust == null ? null : r2(gust * KN_TO_MS),
      dir_deg: ix.drct >= 0 ? num(c[ix.drct]) : null,
    });
  }
  return out;
}

// METARs kommen typisch um :50 — der Report, der der vollen Stunde am nächsten
// liegt, repräsentiert sie; :50 gehört also zur FOLGENDEN Stunde.
export function hourlyFromReports(reports) {
  const best = new Map();
  for (const r of reports) {
    const hour = Math.round(r.t / HOUR_MS) * HOUR_MS;
    const delta = Math.abs(r.t - hour);
    if (delta > 30 * 60000) continue;
    const prev = best.get(hour);
    if (!prev || delta < prev.delta) best.set(hour, { delta, r });
  }
  const out = new Map();
  for (const [hour, { r }] of [...best].sort((a, b) => a[0] - b[0])) {
    out.set(hourTs(hour), { wind_ms: r.wind_ms, gust_ms: r.gust_ms, dir_deg: r.dir_deg, source: 'iem' });
  }
  return out;
}

// ── Fetcher ─────────────────────────────────────────────────────────────────
async function getChecked(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 429) throw new RateLimitError(url);
  return res;
}

// ── Open-Meteo-Budget ───────────────────────────────────────────────────────
// Gewicht nach Open-Meteo-Regel: Orte × max(1, Tage/14) × max(1, Variablen/10) × Modelle.
export function omWeight({ locations = 1, days = 1, variables = 1, models = 1 } = {}) {
  return locations * Math.max(1, days / 14) * Math.max(1, variables / 10) * models;
}

export function createBudget(db, { max = OM_DAILY_BUDGET, now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = 'ml_om_budget';
  let used = 0;
  try {
    const row = db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);
    const v = row ? JSON.parse(row.value) : null;
    if (v && v.day === day) used = v.used;
  } catch { /* app_meta fehlt: Budget nur im Speicher */ }
  const persist = () => {
    try {
      db.prepare(`INSERT INTO app_meta(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(key, JSON.stringify({ day, used: Math.round(used * 10) / 10 }), new Date().toISOString());
    } catch { /* s. o. */ }
  };
  return {
    get used() { return used; }, max,
    spend(w, url = 'open-meteo') {
      if (used + w > max) throw new RateLimitError(url, 'budget');
      used += w; persist();
    },
  };
}

const unlimited = { used: 0, max: Infinity, spend() {} };

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function meteostatYears(sinceDay, endDay) {
  const out = [];
  for (let y = +sinceDay.slice(0, 4); y <= +endDay.slice(0, 4); y++) out.push(y);
  return out;
}

export async function fetchMeteostatHourly(meteostatId, fetchImpl = fetch,
  { sinceDay = null, endDay = null, stats = null } = {}) {
  const years = sinceDay && endDay ? meteostatYears(sinceDay, endDay) : [new Date().getUTCFullYear()];
  const out = new Map();
  for (const y of years) {
    const res = await getChecked(`https://data.meteostat.net/hourly/${y}/${meteostatId}.csv.gz`, fetchImpl);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`meteostat_hourly_${res.status}`);
    const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    for (const [k, v] of parseMeteostatHourlyCsv(csv, { sinceDay, stats })) out.set(k, v);
  }
  return out;
}

export function iemAsosUrl(icao, startDay, endDay) {
  // IEM-Enddatum ist exklusiv → +1 Tag, damit endDay vollständig drin ist.
  const end = addDays(endDay, 1);
  const p = new URLSearchParams([
    ['station', icao], ['data', 'sknt'], ['data', 'gust'], ['data', 'drct'],
    ['year1', startDay.slice(0, 4)], ['month1', String(+startDay.slice(5, 7))], ['day1', String(+startDay.slice(8, 10))],
    ['year2', end.slice(0, 4)], ['month2', String(+end.slice(5, 7))], ['day2', String(+end.slice(8, 10))],
    ['tz', 'Etc/UTC'], ['format', 'onlycomma'], ['latlon', 'no'], ['missing', 'null'],
    ['trace', 'null'], ['direct', 'no'], ['report_type', '3'], ['report_type', '4'],
  ]);
  return `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${p}`;
}

export async function fetchIemAsos(icao, startDay, endDay, fetchImpl = fetch) {
  const res = await getChecked(iemAsosUrl(icao, startDay, endDay), fetchImpl);
  if (!res.ok) throw new Error(`iem_${res.status}`);
  return hourlyFromReports(parseIemAsosCsv(await res.text()));
}

const GMT_TS = t => `${t}:00Z`;

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;

export async function fetchHistoricalFeatures(lat, lon, startDay, endDay, fetchImpl = fetch, budget = unlimited) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, start_date: startDay, end_date: endDay,
    hourly: 'wind_speed_10m,wind_direction_10m,surface_pressure,temperature_2m,cape',
    wind_speed_unit: 'ms', timezone: 'GMT',
  });
  const url = `https://historical-forecast-api.open-meteo.com/v1/forecast?${p}`;
  budget.spend(omWeight({ days: daysBetween(startDay, endDay), variables: 5 }), url);
  const res = await getChecked(url, fetchImpl);
  const j = await res.json();
  if (!res.ok || !j?.hourly?.time) throw new Error(j?.reason || `historical_forecast_${res.status}`);
  const h = j.hourly;
  const out = new Map();
  for (let i = 0; i < h.time.length; i++) {
    if (h.wind_speed_10m?.[i] == null) continue;
    out.set(GMT_TS(h.time[i]), {
      fc_wind_ms: h.wind_speed_10m[i],
      fc_dir_deg: h.wind_direction_10m?.[i] ?? null,
      fc_pressure_hpa: h.surface_pressure?.[i] ?? null,
      fc_temp_c: h.temperature_2m?.[i] ?? null,
      fc_cape: h.cape?.[i] ?? null,
    });
  }
  return out;
}

const PREV_LEADS = [[24, 'day1'], [48, 'day2']];

function prevFeatures(h, i, suffix) {
  const w = h[`wind_speed_10m_previous_${suffix}`]?.[i];
  if (w == null) return null;
  return {
    fc_wind_ms: w,
    fc_dir_deg: h[`wind_direction_10m_previous_${suffix}`]?.[i] ?? null,
    fc_pressure_hpa: h[`surface_pressure_previous_${suffix}`]?.[i] ?? null,
    fc_temp_c: h[`temperature_2m_previous_${suffix}`]?.[i] ?? null,
    fc_cape: null,
  };
}

// previous-runs-api reicht nur bis ~2024 zurück: Lücken sind normal, kein Abbruch.
// Rückgabe-Map trägt .ok: false = Abruf gescheitert (≠ legitim leer vor 2024).
export async function fetchPreviousRunFeatures(lat, lon, startDay, endDay, fetchImpl = fetch, budget = unlimited) {
  const vars = ['wind_speed_10m', 'wind_direction_10m', 'temperature_2m', 'surface_pressure'];
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, start_date: startDay, end_date: endDay,
    hourly: vars.flatMap(v => [`${v}_previous_day1`, `${v}_previous_day2`]).join(','),
    wind_speed_unit: 'ms', timezone: 'GMT',
  });
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast?${p}`;
  budget.spend(omWeight({ days: daysBetween(startDay, endDay), variables: vars.length * 2 }), url);
  const res = await getChecked(url, fetchImpl);
  const out = new Map();
  out.ok = res.ok;
  if (!res.ok) return out;
  const j = await res.json().catch(() => null);
  const h = j?.hourly;
  if (!h?.time) { out.ok = false; return out; }
  for (let i = 0; i < h.time.length; i++) {
    const entry = {};
    for (const [lead, suffix] of PREV_LEADS) {
      const f = prevFeatures(h, i, suffix);
      if (f) entry[lead] = f;
    }
    if (Object.keys(entry).length) out.set(GMT_TS(h.time[i]), entry);
  }
  return out;
}

function ensembleByTs(byKey) {
  const out = new Map();
  for (const [k, v] of byKey || []) {
    const [day, h] = k.split('|');
    out.set(`${day}T${pad2(parseInt(h, 10))}:00:00Z`, v);
  }
  return out;
}

async function fetchEnsembleSafe(st, startDay, endDay, fetchImpl, fetchEnsemble, budget = unlimited) {
  const charged = url => {
    const models = (new URL(url).searchParams.get('models') || '').split(',').filter(Boolean).length || 1;
    budget.spend(omWeight({ days: daysBetween(startDay, endDay), variables: 1, models }), url);
    return getChecked(url, fetchImpl);
  };
  try {
    const { byKey } = await fetchEnsemble({ lat: st.lat, lon: st.lon, tz: 'GMT' }, startDay, endDay, charged);
    const out = ensembleByTs(byKey);
    out.ok = out.size > 0;
    return out;
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    const out = new Map(); out.ok = false;
    return out;
  }
}

// ── Pairing ─────────────────────────────────────────────────────────────────
function makeRow(base, lead, obs, fc, ensWind) {
  const bias = obs.wind_ms - fc.fc_wind_ms;
  if (!Number.isFinite(bias) || Math.abs(bias) > MAX_ABS_BIAS) return null;
  return {
    ...base,
    fc_lead_hours: lead,
    obs_wind_ms: r2(obs.wind_ms), obs_gust_ms: r2(obs.gust_ms), obs_dir_deg: r2(obs.dir_deg),
    fc_wind_ms: r2(fc.fc_wind_ms), fc_dir_deg: r2(fc.fc_dir_deg), fc_pressure_hpa: r2(fc.fc_pressure_hpa),
    fc_temp_c: r2(fc.fc_temp_c), fc_cape: r2(fc.fc_cape),
    fc_ens_wind_ms: r2(ensWind ?? null),
    bias_ms: r2(bias),
  };
}

export function pairHistory({ stationKey, tz, obsByTs, fc0, prev = new Map(), ens = new Map(), source = null }) {
  const rows = [];
  for (const [ts, obs] of obsByTs) {
    if (obs?.wind_ms == null) continue;
    const { day, hour } = localPartsTZ(Date.parse(ts), tz);
    const base = { station_key: stationKey, ts, hour_local: hour, month: parseInt(day.slice(5, 7), 10),
                   source: obs.source || source };
    const f0 = fc0?.get(ts);
    if (f0) rows.push(makeRow(base, 0, obs, f0, ens.get(ts)));
    const p = prev.get(ts);
    for (const [lead] of PREV_LEADS) if (p?.[lead]) rows.push(makeRow(base, lead, obs, p[lead], null));
  }
  return rows.filter(Boolean);
}

// ── Chunks + Fortschritt ────────────────────────────────────────────────────
export function yesterdayUtc(now = Date.now()) {
  return new Date(now - 86400000).toISOString().slice(0, 10);
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Ganze Kalendermonate, damit ein später fortgesetzter Lauf dieselben Chunk-
// Grenzen trifft; nur der jüngste Monat endet an endDay.
export function monthChunks(endDay, months) {
  const y = +endDay.slice(0, 4), m = +endDay.slice(5, 7);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const cy = d.getUTCFullYear(), cm = d.getUTCMonth() + 1;
    const full = lastDayOfMonth(cy, cm);
    const end = full < endDay ? full : endDay;
    out.push({ chunk: `${cy}-${pad2(cm)}`, startDay: `${cy}-${pad2(cm)}-01`, endDay: end, complete: end === full });
  }
  return out;
}

function chunkRow(db, key, chunk) {
  return db.prepare('SELECT status, updated_at FROM ml_backfill_progress WHERE station_key=? AND chunk=?').get(key, chunk) ?? null;
}

// Fällig: nie versucht, oder partial/error und die Wartezeit ist um.
export function chunkDue(row, now = Date.now()) {
  if (!row) return true;
  if (row.status === 'done') return false;
  const age = now - Date.parse(row.updated_at);
  return row.status === 'error' ? age >= RETRY_ERROR_MS : age >= RETRY_PARTIAL_MS;
}

function writeProgress(db, key, chunk, status, rows, error = null) {
  db.prepare(`INSERT INTO ml_backfill_progress (station_key, chunk, status, rows, error, updated_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(station_key, chunk) DO UPDATE SET
                status=excluded.status, rows=excluded.rows, error=excluded.error, updated_at=excluded.updated_at`)
    .run(key, chunk, status, rows, error, new Date().toISOString());
}

const HISTORY_COLS = ['station_key', 'ts', 'fc_lead_hours', 'hour_local', 'month', 'obs_wind_ms', 'obs_gust_ms',
  'obs_dir_deg', 'fc_wind_ms', 'fc_dir_deg', 'fc_pressure_hpa', 'fc_temp_c', 'fc_cape', 'fc_ens_wind_ms',
  'bias_ms', 'source'];

function insertHistory(db, rows) {
  const stmt = db.prepare(`INSERT OR REPLACE INTO ml_history (${HISTORY_COLS.join(',')})
                           VALUES (${HISTORY_COLS.map(() => '?').join(',')})`);
  db.transaction(() => { for (const r of rows) stmt.run(...HISTORY_COLS.map(c => r[c] ?? null)); })();
}

export function pendingChunks(db, stationKey, { months = 24, endDay = yesterdayUtc(), now = Date.now() } = {}) {
  return monthChunks(endDay, months).filter(c => chunkDue(chunkRow(db, stationKey, c.chunk), now));
}

function obsForChunk(meteostat, iem, c) {
  const from = `${c.startDay}T00:00:00Z`, to = `${c.endDay}T23:00:00Z`;
  const out = new Map();
  for (const [ts, o] of meteostat) if (ts >= from && ts <= to) out.set(ts, o);
  for (const [ts, o] of iem) out.set(ts, o);   // IEM hat Vorrang vor Meteostat
  return out;
}

// 'done' nur, wenn der Monat vollständig UND alle Quellen geliefert haben. Sonst
// 'partial' → wird (gedrosselt) erneut versucht, statt still als Lücke zu enden.
export function finalStatus(c, { rows, coverage = 1, ensOk = true, prevOk = true }, endDay) {
  const ageDays = (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${c.endDay}T00:00:00Z`)) / 86400000;
  const old = ageDays > EMPTY_RETRY_DAYS;
  if (!c.complete) return 'partial';
  if (rows === 0) return old ? 'done' : 'partial';
  const sourcesOk = ensOk && (prevOk || c.chunk < PREV_RUNS_FROM);
  return sourcesOk && (coverage >= MIN_COVERAGE || old) ? 'done' : 'partial';
}

async function processChunk(db, st, c, ctx) {
  const { fetchImpl, sleepMs, fetchEnsemble, meteostat, endDay, budget } = ctx;
  let iem = new Map();
  if (st.icao) { iem = await fetchIemAsos(st.icao, c.startDay, c.endDay, fetchImpl); await sleep(sleepMs); }
  const obs = obsForChunk(meteostat, iem, c);
  // Ohne Obs keine Open-Meteo-Calls — schont das Tagesbudget.
  if (!obs.size) { writeProgress(db, st.key, c.chunk, finalStatus(c, { rows: 0 }, endDay), 0); return 0; }

  const fc0 = await fetchHistoricalFeatures(st.lat, st.lon, c.startDay, c.endDay, fetchImpl, budget);
  await sleep(sleepMs);
  const prev = await fetchPreviousRunFeatures(st.lat, st.lon, c.startDay, c.endDay, fetchImpl, budget);
  await sleep(sleepMs);
  const ens = await fetchEnsembleSafe(st, c.startDay, c.endDay, fetchImpl, fetchEnsemble, budget);
  await sleep(sleepMs);

  const rows = pairHistory({ stationKey: st.key, tz: st.tz || 'UTC', obsByTs: obs, fc0, prev, ens });
  insertHistory(db, rows);
  const coverage = new Set([...obs.keys()].map(ts => ts.slice(0, 10))).size / daysBetween(c.startDay, c.endDay);
  const status = finalStatus(c, { rows: rows.length, coverage, ensOk: ens.ok !== false, prevOk: prev.ok !== false }, endDay);
  const note = status === 'partial'
    ? [ens.ok === false && 'ensemble', prev.ok === false && 'previous_runs', coverage < MIN_COVERAGE && `coverage ${Math.round(coverage * 100)}%`]
        .filter(Boolean).join(', ') || null
    : null;
  writeProgress(db, st.key, c.chunk, status, rows.length, note);
  return rows.length;
}

// Meteostat-Ausfall darf nicht als "keine Daten" quittiert werden: ohne ICAO
// (also ohne IEM-Ersatz) bricht die Station ab, alle Chunks bleiben offen.
async function loadMeteostat(st, fetchImpl, log, sinceDay, endDay) {
  const id = st.meteostatId ?? st.meteostat_id;
  if (!id) return new Map();
  const stats = new Map();
  try {
    const m = await fetchMeteostatHourly(id, fetchImpl, { sinceDay, endDay, stats });
    log(`[ml-backfill] ${st.key}: Meteostat ${m.size} Obs-Stunden · Quellen ${JSON.stringify(Object.fromEntries(stats))}`);
    return m;
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    if (!st.icao) throw new Error(`meteostat_unavailable: ${e.message}`);
    log(`[ml-backfill] ${st.key}: Meteostat nicht verfügbar (${e.message}) — nur IEM`);
    return new Map();
  }
}

export async function backfillStation(db, st, {
  months = 24, endDay = yesterdayUtc(), fetchImpl = fetch, sleepMs = 1500,
  log = () => {}, fetchEnsemble = fetchHistoricalEnsemble, onChunk = () => {},
  budget = unlimited, now = Date.now(),
} = {}) {
  const all = monthChunks(endDay, months);
  const todo = all.filter(c => chunkDue(chunkRow(db, st.key, c.chunk), now));
  const result = { station: st.key, chunks: 0, rows: 0, skipped: all.length - todo.length, errors: 0 };
  if (!todo.length) return result;

  let meteostat;
  try { meteostat = await loadMeteostat(st, fetchImpl, log, todo[0].startDay, endDay); }
  catch (e) {
    if (e instanceof RateLimitError) throw e;
    log(`[ml-backfill] ${st.key}: abgebrochen (${e.message})`);
    return { ...result, errors: 1, error: e.message };
  }
  if ((st.meteostatId ?? st.meteostat_id)) await sleep(sleepMs);
  const ctx = { fetchImpl, sleepMs, fetchEnsemble, meteostat, endDay, budget };

  for (const c of todo) {
    try {
      const n = await processChunk(db, st, c, ctx);
      result.chunks++; result.rows += n;
      onChunk(c.chunk);
      log(`[ml-backfill] ${st.key} ${c.chunk}: ${n} Zeilen`);
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      result.errors++;
      writeProgress(db, st.key, c.chunk, 'error', 0, String(e.message).slice(0, 300));
      log(`[ml-backfill] ${st.key} ${c.chunk}: Fehler ${e.message}`);
    }
  }
  return result;
}

export async function runBackfill(db, stations, { onProgress = () => {}, budget = null, ...opts } = {}) {
  opts.budget = budget ?? createBudget(db);
  const results = [];
  const total = stations.length;
  for (let i = 0; i < total; i++) {
    const st = stations[i];
    const onChunk = chunk => onProgress({ station: st.key, chunk, done: i, total });
    onProgress({ station: st.key, chunk: null, done: i, total });
    try {
      const r = await backfillStation(db, st, { ...opts, onChunk });
      results.push(r);
      onProgress({ station: st.key, chunk: null, done: i + 1, total, result: r });
    } catch (e) {
      if (!(e instanceof RateLimitError)) throw e;
      onProgress({ station: st.key, chunk: null, done: i, total, rateLimited: true, reason: e.reason });
      return { ok: false, rateLimited: true, reason: e.reason, stoppedAt: st.key, results,
               budgetUsed: opts.budget.used };
    }
  }
  return { ok: true, rateLimited: false, results, rows: results.reduce((s, r) => s + r.rows, 0),
           budgetUsed: opts.budget.used };
}
