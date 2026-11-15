// ============================================================================
// WindFoil — Live-Polling der automatisch gewählten ML-Stationen
// File version: 1.0.0 (ESM .mjs)  |  App target: v3.42.0
// ----------------------------------------------------------------------------
// Stündlich EIN METAR-Request für alle ICAO-Stationen und EIN Open-Meteo-
// Multi-Location-Request (bis FC_BATCH Orte) für die Features aller Stationen.
// Achtung Budget: Open-Meteo zählt Multi-Location JE ORT — 40 Stationen ≈ 960
// Calls/Tag. Gespart wird der Overhead, nicht das Kontingent.
// Die 72-h-Features werden je Station gespeichert (ml_fc72:{key}) und speisen die
// situative Neural-Vorhersage in /api/station/mos.
//
// Zeitstempel in ml_samples sind hier STUNDENGENAU (Zielstunde). Damit treffen
// sich lead=0 und die früher abgegebene lead=24/48-Prognose exakt.
// ============================================================================

export const ML_POLL_MS        = 60 * 60 * 1000;
export const METAR_MAX_AGE_MS  = 90 * 60 * 1000;
export const METAR_BATCH       = 40;
export const FC_BATCH          = 50;
const KN_TO_MS = 0.514444;
const FETCH_TIMEOUT_MS = 20000;

const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

export function hourTs(epochMs) {
  return new Date(Math.round(epochMs / 3600e3) * 3600e3).toISOString().slice(0, 13) + ':00:00Z';
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function metarUrl(icaos) {
  return `https://aviationweather.gov/api/data/metar?ids=${icaos.map(encodeURIComponent).join(',')}&format=json&hours=2`;
}

// aviationweather-JSON → jüngste Beobachtung je ICAO. "VRB"/fehlend → null.
export function parseMetarBatch(arr, nowMs = Date.now()) {
  const out = new Map();
  if (!Array.isArray(arr)) return out;
  for (const ob of arr) {
    const icao = ob && String(ob.icaoId || '').toUpperCase();
    const ep = parseFloat(ob && ob.obsTime) * 1000;
    const w = parseFloat(ob && ob.wspd);
    if (!icao || !Number.isFinite(ep) || !Number.isFinite(w)) continue;
    if (nowMs - ep > METAR_MAX_AGE_MS) continue;
    const prev = out.get(icao);
    if (prev && prev.epochMs >= ep) continue;
    const g = parseFloat(ob.wgst), d = parseFloat(ob.wdir);
    out.set(icao, {
      epochMs: ep, ts: new Date(ep).toISOString(), hourTs: hourTs(ep),
      wind_ms: r2(w * KN_TO_MS), gust_ms: Number.isFinite(g) ? r2(g * KN_TO_MS) : null,
      dir_deg: Number.isFinite(d) ? Math.round(d) : null,
    });
  }
  return out;
}

export function forecastUrl(stations) {
  const p = new URLSearchParams({
    latitude: stations.map(s => s.lat).join(','),
    longitude: stations.map(s => s.lon).join(','),
    hourly: 'windspeed_10m,winddirection_10m,surface_pressure,temperature_2m,cape',
    wind_speed_unit: 'ms', forecast_days: 3, timezone: 'UTC',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

// Open-Meteo liefert bei mehreren Koordinaten ein Array, bei einer ein Objekt.
export function parseForecastBatch(json, stations) {
  const list = Array.isArray(json) ? json : [json];
  const out = new Map();
  stations.forEach((s, i) => { if (list[i]?.hourly?.time) out.set(s.station_key, list[i].hourly); });
  return out;
}

export function featuresAt(hourly, ts) {
  const idx = hourly.time.indexOf(ts.slice(0, 16));
  if (idx < 0) return null;
  return {
    fc_wind_ms: hourly.windspeed_10m?.[idx] ?? null,
    fc_dir_deg: hourly.winddirection_10m?.[idx] ?? null,
    fc_pressure_hpa: hourly.surface_pressure?.[idx] ?? null,
    fc_temp_c: hourly.temperature_2m?.[idx] ?? null,
    fc_cape: hourly.cape?.[idx] ?? null,
  };
}

const tzFmt = new Map();
function localHourMonth(ts, tz) {
  if (!tzFmt.has(tz)) tzFmt.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit', hour: '2-digit', hour12: false }));
  const p = tzFmt.get(tz).formatToParts(new Date(ts)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { hour: parseInt(p.hour, 10) % 24, month: parseInt(p.month, 10) };
}

// → Zeilen für ml_samples: lead 0 (mit Obs) + lead 24/48 (Prognose für später).
export function buildSamples(st, obs, hourly) {
  const rows = [];
  const f0 = featuresAt(hourly, obs.hourTs);
  if (f0 && f0.fc_wind_ms != null) {
    const { hour, month } = localHourMonth(obs.hourTs, st.tz);
    rows.push({ ts: obs.hourTs, lead: 0, hour, month, obs: obs.wind_ms, gust: obs.gust_ms,
                ...f0, bias_ms: r2(obs.wind_ms - f0.fc_wind_ms) });
  }
  for (const lead of [24, 48]) {
    const target = new Date(Date.parse(obs.hourTs) + lead * 3600e3).toISOString().slice(0, 13) + ':00:00Z';
    const f = featuresAt(hourly, target);
    if (!f || f.fc_wind_ms == null) continue;
    const { hour, month } = localHourMonth(target, st.tz);
    rows.push({ ts: target, lead, hour, month, obs: null, gust: null, ...f, bias_ms: null });
  }
  return rows;
}

// IO-Orchestrierung. db braucht ml_samples + station_obs; fetchImpl injizierbar.
export async function pollMlStationsOnce(db, stations, {
  fetchImpl = fetch, nowMs = Date.now(), log = () => {}, onForecast = () => {},
} = {}) {
  const enabled = stations.filter(s => s.enabled !== 0);
  const icaoSt = enabled.filter(s => s.icao && s.live_source === 'metar');
  if (!enabled.length) return { polled: 0, obs: 0, samples: 0, forecasts: 0 };
  const opt = () => ({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  const obsBy = new Map();
  for (const part of chunk(icaoSt, METAR_BATCH)) {
    try {
      const r = await fetchImpl(metarUrl(part.map(s => s.icao)), opt());
      if (!r.ok) { log(`metar ${r.status}`); continue; }
      for (const [k, v] of parseMetarBatch(await r.json(), nowMs)) obsBy.set(k, v);
    } catch (e) { log(`metar ${e.message}`); }
  }
  const withObs = icaoSt.filter(s => obsBy.has(s.icao));
  const fcBy = new Map();
  for (const part of chunk(enabled, FC_BATCH)) {
    try {
      const r = await fetchImpl(forecastUrl(part), opt());
      if (!r.ok) { log(`open-meteo ${r.status}`); continue; }
      for (const [k, v] of parseForecastBatch(await r.json(), part)) fcBy.set(k, v);
    } catch (e) { log(`open-meteo ${e.message}`); }
  }
  const issuedAt = new Date(nowMs).toISOString();
  for (const [key, hourly] of fcBy) onForecast(key, hourly, issuedAt);

  const insObs = db.prepare(`INSERT OR IGNORE INTO station_obs (station_key, ts, wind_ms, gust_ms, lat, lon)
                             VALUES (?,?,?,?,?,?)`);
  const insSample = db.prepare(`INSERT OR IGNORE INTO ml_samples
      (station_key, ts, fc_lead_hours, hour_local, month, obs_wind_ms, obs_gust_ms,
       fc_wind_ms, fc_dir_deg, fc_pressure_hpa, fc_temp_c, fc_cape, bias_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let nObs = 0, nSamples = 0;
  db.transaction(() => {
    for (const st of withObs) {
      const o = obsBy.get(st.icao);
      nObs += insObs.run(st.station_key, o.ts, o.wind_ms, o.gust_ms, st.lat, st.lon).changes;
      const hourly = fcBy.get(st.station_key);
      if (!hourly) continue;
      for (const s of buildSamples(st, o, hourly)) {
        nSamples += insSample.run(st.station_key, s.ts, s.lead, s.hour, s.month, s.obs, s.gust,
          s.fc_wind_ms, s.fc_dir_deg, s.fc_pressure_hpa, s.fc_temp_c, s.fc_cape, s.bias_ms).changes;
      }
    }
  })();
  return { polled: icaoSt.length, obs: nObs, samples: nSamples, forecasts: fcBy.size };
}
