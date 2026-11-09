// ============================================================================
// WindFoil — Gebündelter Forecast-Proxy mit Cache
// Mount:  app.use('/api/forecast', forecastRouter)   // absichtlich ohne Auth
// ----------------------------------------------------------------------------
// vergleich.html holte 79 Einzel-Forecasts pro Seitenaufruf (40 Spots + 39
// Wassertemperaturen), die Regionsseiten 7–23. Open-Meteos Free-Tier erlaubt
// 10.000 Calls/Tag — das reichte für rund 126 Seitenaufrufe.
//
// Open-Meteo nimmt Koordinatenlisten an und antwortet mit einem Array in
// derselben Reihenfolge. Diese Routen bündeln eine ganze Region in EINEN
// Upstream-Call und halten das Ergebnis 15 Minuten vor. Der Upstream-Verbrauch
// hängt damit an der Zahl der Regionen, nicht am Traffic.
//
// Regionen kommen aus spots.json, Koordinaten NICHT aus der Anfrage: sonst
// wäre das hier ein offener Wetter-Proxy für Dritte.
// ============================================================================
import { Router } from 'express';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const forecastRouter = Router();

const SPOTS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'spots.json');
const OM_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OM_MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const OM_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

const CACHE_TTL_MS = 15 * 60_000;
// ERA5 wird einmal täglich ergänzt — ein 15-Minuten-Cache würde 96 Calls pro
// Region und Tag für Daten verbrauchen, die sich einmal ändern.
const HISTORY_TTL_MS = 6 * 60 * 60_000;
const HISTORY_DAYS = 14;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_COORDS_PER_CALL = 50;   // 40 sind erprobt; darüber wird gestückelt
const WIND_VARS = 'windspeed_10m,windgusts_10m,winddirection_10m,temperature_2m';

// ── spots.json ───────────────────────────────────────────────────────────────

let spotsCache = { mtimeMs: 0, data: null };

/** Liest spots.json neu, wenn die Datei sich geändert hat — ein Deploy der
 *  Spot-Liste braucht damit keinen Service-Restart. */
function loadSpots() {
  const mtimeMs = statSync(SPOTS_FILE).mtimeMs;
  if (!spotsCache.data || mtimeMs !== spotsCache.mtimeMs) {
    spotsCache = { mtimeMs, data: JSON.parse(readFileSync(SPOTS_FILE, 'utf8')) };
  }
  return spotsCache.data;
}

/** Spots einer Region. "all" ist die Vereinigung aller Regionen plus der
 *  Spots ohne eigene Seite — das ist die Menge, die vergleich.html braucht. */
function resolveRegion(key) {
  const j = loadSpots();
  if (key === 'all') {
    const spots = [...Object.values(j.regions).flatMap(r => r.spots), ...(j.unpagedSpots || [])];
    return { key, spots, model: null };
  }
  const r = j.regions[key];
  if (!r) return null;
  return { key, spots: r.spots, model: r.model || null };
}

// ── Cache ────────────────────────────────────────────────────────────────────

// Der Body wird als fertiger JSON-String abgelegt: ein Treffer ist dann ein
// res.send(), nicht ein erneutes Serialisieren von ~200 KB.
const cache = new Map();
const inflight = new Map();

function cacheGet(key) {
  const e = cache.get(key);
  if (e && Date.now() < e.exp) return e;
  if (e) cache.delete(key);
  return null;
}

/** Gleichzeitige Anfragen auf denselben Schlüssel teilen einen Upstream-Call —
 *  ohne das löst ein Cache-Ablauf bei Parallelzugriff N Calls aus. */
function withCache(key, producer, ttlMs = CACHE_TTL_MS) {
  const hit = cacheGet(key);
  if (hit) return Promise.resolve({ body: hit.body, ttlMs: hit.ttlMs, ageSec: Math.round((Date.now() - hit.at) / 1000), cached: true });

  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    const payload = await producer();
    const body = JSON.stringify(payload);
    cache.set(key, { body, ttlMs, at: Date.now(), exp: Date.now() + ttlMs });
    return { body, ttlMs, ageSec: 0, cached: false };
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

// ── Upstream ─────────────────────────────────────────────────────────────────

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Ein Open-Meteo-Call je Koordinaten-Stück. Die Antwort ist bei einer
 *  Koordinatenliste ein Array, bei einer einzelnen Koordinate ein Objekt. */
async function fetchChunked(base, spots, params) {
  const out = [];
  for (const part of chunk(spots, MAX_COORDS_PER_CALL)) {
    const p = new URLSearchParams({
      ...params,
      latitude: part.map(s => s.lat).join(','),
      longitude: part.map(s => s.lon).join(','),
    });
    const r = await fetch(`${base}?${p}`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = await r.json();
    out.push(...(Array.isArray(j) ? j : [j]));
  }
  if (out.length !== spots.length) throw new Error(`upstream lieferte ${out.length} von ${spots.length}`);
  return out;
}

async function buildForecast(region, days) {
  const params = { hourly: WIND_VARS, wind_speed_unit: 'ms', forecast_days: String(days), timezone: 'auto' };
  if (region.model) params.models = region.model;

  // Regionale HD-Modelle (AROME) liefern kein weathercode, nur Wind. Ohne
  // Modellangabe kommt es im selben Call mit.
  const wxSeparately = Boolean(region.model);
  if (!wxSeparately) params.hourly = `${WIND_VARS},weathercode`;

  const [wind, wx] = await Promise.all([
    fetchChunked(OM_FORECAST, region.spots, params),
    wxSeparately
      ? fetchChunked(OM_FORECAST, region.spots, { hourly: 'weathercode', forecast_days: String(days), timezone: 'auto' })
          .catch(() => null)   // weathercode ist Dekoration, kein Grund zu scheitern
      : Promise.resolve(null),
  ]);

  const spots = {};
  region.spots.forEach((s, i) => {
    const hourly = wind[i]?.hourly;
    if (!hourly?.windspeed_10m) { spots[s.id] = null; return; }
    if (wx?.[i]?.hourly?.weathercode) hourly.weathercode = wx[i].hourly.weathercode;
    // timezone=auto liefert Ortszeit ohne Zone — ohne den Offset kann der
    // Windalarm nicht entscheiden, ob eine Session schon vorbei ist.
    spots[s.id] = { hourly, utcOffsetSeconds: wind[i]?.utc_offset_seconds ?? null };
  });
  return { region: region.key, days, spots };
}

/** Wassertemperatur wird serverseitig auf das Tagesmittel 9–18 Uhr verdichtet:
 *  der Client nutzt nur diese Zahl, die Stundenreihe wären 35 KB statt 1 KB. */
async function buildMarine(region) {
  const usable = region.spots.filter(s => !s.noMarine);
  const rows = await fetchChunked(OM_MARINE, usable, {
    hourly: 'sea_surface_temperature', forecast_days: '1', timezone: 'auto',
  });

  const sst = {};
  for (const s of region.spots) sst[s.id] = null;
  usable.forEach((s, i) => {
    const vals = rows[i]?.hourly?.sea_surface_temperature;
    if (!vals) return;
    const valid = vals.slice(9, 18).filter(v => v != null);
    sst[s.id] = valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null;
  });
  return { region: region.key, sst };
}

/** Nur die Stunden 9–18 ausliefern: der Client wertet beim Rückblick ohnehin
 *  nur dieses Fenster aus, die übrigen 14 Stunden pro Tag sind Ballast. */
function trimToDaylight(h) {
  const keep = [];
  h.time.forEach((t, i) => {
    const hr = Number(t.slice(11, 13));
    if (hr >= 9 && hr <= 18) keep.push(i);
  });
  const out = {};
  for (const [k, v] of Object.entries(h)) out[k] = Array.isArray(v) ? keep.map(i => v[i]) : v;
  return out;
}

async function buildHistory(region) {
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - (HISTORY_DAYS - 1) * 86_400_000);
  const fmt = d => d.toISOString().slice(0, 10);

  const rows = await fetchChunked(OM_ARCHIVE, region.spots, {
    start_date: fmt(start), end_date: fmt(end),
    hourly: WIND_VARS, wind_speed_unit: 'ms', timezone: 'auto',
  });

  const spots = {};
  region.spots.forEach((s, i) => {
    const hourly = rows[i]?.hourly;
    spots[s.id] = hourly?.time ? { hourly: trimToDaylight(hourly) } : null;
  });
  return { region: region.key, days: HISTORY_DAYS, spots };
}

// ── Routen ───────────────────────────────────────────────────────────────────

function send(res, { body, ttlMs, ageSec, cached }) {
  res.set('Cache-Control', `public, max-age=${Math.max(0, Math.round(ttlMs / 1000) - ageSec)}`);
  res.set('X-Cache', cached ? `HIT age=${ageSec}` : 'MISS');
  res.type('application/json').send(body);
}

function fail(res, e) {
  // 502, nicht 500: die Ursache liegt upstream. Der Client fällt dann auf den
  // Direktaufruf bei Open-Meteo zurück, statt die Seite leer zu lassen.
  res.status(502).json({ error: 'upstream_unavailable', detail: String(e.message || e) });
}

forecastRouter.get('/batch', async (req, res) => {
  const region = resolveRegion(String(req.query.region || ''));
  if (!region) return res.status(404).json({ error: 'unknown_region' });

  // Fehlendes days ist der Default, ein vorhandenes aber ungültiges ein Fehler —
  // `Number(x) || 3` würde "0" und "abc" stillschweigend zu 3 umdeuten.
  const days = req.query.days === undefined ? 3 : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    return res.status(400).json({ error: 'days_out_of_range' });
  }

  try {
    send(res, await withCache(`fc|${region.key}|${days}`, () => buildForecast(region, days)));
  } catch (e) { fail(res, e); }
});

forecastRouter.get('/marine', async (req, res) => {
  const region = resolveRegion(String(req.query.region || ''));
  if (!region) return res.status(404).json({ error: 'unknown_region' });

  try {
    send(res, await withCache(`sst|${region.key}`, () => buildMarine(region)));
  } catch (e) { fail(res, e); }
});

forecastRouter.get('/history', async (req, res) => {
  const region = resolveRegion(String(req.query.region || ''));
  if (!region) return res.status(404).json({ error: 'unknown_region' });

  try {
    send(res, await withCache(`hist|${region.key}`, () => buildHistory(region), HISTORY_TTL_MS));
  } catch (e) { fail(res, e); }
});

// Sichtbarkeit für den Health-Check: wie viel Upstream der Cache gerade spart.
forecastRouter.get('/cache', (_req, res) => {
  const now = Date.now();
  res.json({
    ttlSec: CACHE_TTL_MS / 1000,
    entries: [...cache.entries()].map(([key, e]) => ({
      key, ageSec: Math.round((now - e.at) / 1000),
      ttlSec: Math.round(e.ttlMs / 1000), bytes: Buffer.byteLength(e.body),
    })),
  });
});

/** Derselbe Cache-Eintrag, den die Vergleichsseite füllt. Der Windalarm liest
 *  darüber mit und kostet so keinen zusätzlichen Open-Meteo-Call. */
export async function getRegionForecast(regionKey, days) {
  const region = resolveRegion(regionKey);
  if (!region) throw new Error(`unbekannte Region: ${regionKey}`);
  const { body } = await withCache(`fc|${region.key}|${days}`, () => buildForecast(region, days));
  return JSON.parse(body);
}

/** Spot-Metadaten (Name, Emoji, offshoreDir) nach ID — für Alarmtexte. */
export function spotsById() {
  const out = {};
  for (const s of resolveRegion('all').spots) out[s.id] = s;
  return out;
}

export const _internals = {
  resolveRegion, buildForecast, buildMarine, buildHistory, trimToDaylight, chunk, withCache, cache,
};
