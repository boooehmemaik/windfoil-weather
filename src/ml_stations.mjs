// ============================================================================
// WindFoil — ML-Stationswahl: jedem Spot automatisch die beste reale Station
// File version: 1.0.0  |  App target: v3.42.0
// ----------------------------------------------------------------------------
// Quelle ist der keyless Meteostat-Katalog. Bevorzugt werden ICAO-Stationen,
// weil nur sie stündlich live über METAR nachgepollt werden können.
// ============================================================================

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const METEOSTAT_CATALOG_URL = 'https://bulk.meteostat.net/v2/stations/lite.json.gz';
const CATALOG_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_HOURLY_AGE_DAYS = 400;
const SPOT_MATCH_KM = 3;

export const EXTRA_SPOTS = [
  { id: 'x_woerthsee',       name: 'Wörthsee',          lat: 48.0717, lon: 11.1683 },
  { id: 'x_pilsensee',       name: 'Pilsensee',         lat: 48.0283, lon: 11.1867 },
  { id: 'x_ammersee_eching', name: 'Ammersee Eching',   lat: 48.0619, lon: 11.1207 },
  { id: 'x_hollerner_see',   name: 'Hollerner See',     lat: 48.2989, lon: 11.6178 },
  { id: 'x_chioggia',        name: 'Chioggia',          lat: 45.2271, lon: 12.3046 },
  { id: 'x_gialova',         name: 'Gialova / Navarino', lat: 36.9485, lon: 21.6953 },
  { id: 'x_vasiliki',        name: 'Vasiliki',          lat: 38.6290, lon: 20.6060 },
  { id: 'x_torbole',         name: 'Torbole',           lat: 45.869,  lon: 10.873 },
  { id: 'x_talamone',        name: 'Talamone',          lat: 42.554,  lon: 11.128 },
  { id: 'x_ulcinj',          name: 'Ulcinj',            lat: 41.9166, lon: 19.2529 },
];

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ── Katalog ─────────────────────────────────────────────────────────────────
function catalogEntry(s) {
  const loc = s?.location;
  if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
  const ids = s.identifiers || {};
  return {
    id: String(s.id),
    name: (s.name && (s.name.en || Object.values(s.name)[0])) || String(s.id),
    country: s.country || '',
    lat: loc.latitude,
    lon: loc.longitude,
    elev: loc.elevation ?? null,
    icao: ids.icao || null,
    wmo: ids.wmo || null,
    tz: s.timezone || 'UTC',
    hourlyEnd: s.inventory?.hourly?.end || null,
  };
}

export function parseMeteostatCatalog(jsonText) {
  const arr = JSON.parse(jsonText);
  return (Array.isArray(arr) ? arr : []).map(catalogEntry).filter(Boolean);
}

function readCache(cacheFile, ttlMs, { requireFresh }) {
  if (!cacheFile) return null;
  try {
    if (requireFresh && Date.now() - statSync(cacheFile).mtimeMs >= ttlMs) return null;
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch { return null; }
}

async function downloadCatalog(fetchImpl) {
  const res = await fetchImpl(METEOSTAT_CATALOG_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`meteostat_catalog_${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  return parseMeteostatCatalog(gunzipSync(gz).toString('utf8'));
}

export async function loadMeteostatCatalog({ fetchImpl = fetch, cacheFile = null, ttlMs = CATALOG_TTL_MS } = {}) {
  const fresh = readCache(cacheFile, ttlMs, { requireFresh: true });
  if (fresh) return fresh;
  try {
    const list = await downloadCatalog(fetchImpl);
    if (cacheFile) {
      try { writeFileSync(cacheFile, JSON.stringify(list)); }
      catch { /* read-only fs: Liste bleibt nur im Speicher */ }
    }
    return list;
  } catch (e) {
    const stale = readCache(cacheFile, ttlMs, { requireFresh: false });
    if (stale) return stale;
    throw e;
  }
}

// ── Spots sammeln ───────────────────────────────────────────────────────────
function spotsFromJson(spotsJson) {
  const out = [];
  for (const region of Object.values(spotsJson?.regions || {})) {
    for (const s of region?.spots || []) {
      if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) out.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon });
    }
  }
  return out;
}

function spotsFromUserLocations(userLocations) {
  return (userLocations || [])
    .filter(u => Number.isFinite(u.latitude) && Number.isFinite(u.longitude))
    .map(u => ({
      id: `u:${u.latitude.toFixed(4)},${u.longitude.toFixed(4)}`,
      name: u.name, lat: u.latitude, lon: u.longitude,
    }));
}

// Reihenfolge = Priorität beim Dedupe: kuratierte Namen schlagen Nutzer-Labels.
export function collectSpots({ spotsJson = null, extraSpots = EXTRA_SPOTS, userLocations = [] } = {}) {
  const seen = new Set();
  const out = [];
  for (const s of [...spotsFromJson(spotsJson), ...(extraSpots || []), ...spotsFromUserLocations(userLocations)]) {
    const k = `${round(s.lat, 2)}|${round(s.lon, 2)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// ── Stationswahl ────────────────────────────────────────────────────────────
function isFresh(st, now) {
  if (!st.hourlyEnd) return false;
  const end = Date.parse(`${st.hourlyEnd}T00:00:00Z`);
  return Number.isFinite(end) && (now - end) / 86400000 <= MAX_HOURLY_AGE_DAYS;
}

function validIcao(icao) {
  const u = String(icao || '').toUpperCase();
  return /^[A-Z]{4}$/.test(u) ? u : null;
}

export function rankCandidates(spot, catalog, { maxKm = 40, now = Date.now() } = {}) {
  const t = now instanceof Date ? now.getTime() : now;
  return (catalog || [])
    .filter(st => isFresh(st, t))
    .map(st => ({ ...st, km: haversineKm(spot.lat, spot.lon, st.lat, st.lon) }))
    .filter(st => st.km <= maxKm)
    .sort((a, b) => a.km - b.km);
}

export function pickStation(spot, catalog, { maxKm = 40, preferKm = 20, now = Date.now() } = {}) {
  const ranked = rankCandidates(spot, catalog, { maxKm, now });
  if (!ranked.length) return null;
  const nearest = ranked[0];
  if (validIcao(nearest.icao)) return nearest;
  const icao = ranked.find(st => validIcao(st.icao));
  if (icao && icao.km <= Math.max(preferKm, 1.5 * nearest.km)) return icao;
  return nearest;
}

export function stationKeyOf(st) {
  return validIcao(st.icao) || `ms:${st.id}`;
}

// ── Persistenz ──────────────────────────────────────────────────────────────
function upsertStation(db, key, st, nowIso) {
  const icao = validIcao(st.icao);
  db.prepare(`
    INSERT INTO ml_stations (station_key, meteostat_id, icao, wmo, label, lat, lon, elev, tz,
                             hourly_end, live_source, enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)
    ON CONFLICT(station_key) DO UPDATE SET
      meteostat_id = excluded.meteostat_id, icao = excluded.icao, wmo = excluded.wmo,
      label = excluded.label, lat = excluded.lat, lon = excluded.lon, elev = excluded.elev,
      tz = excluded.tz, hourly_end = excluded.hourly_end, live_source = excluded.live_source,
      updated_at = excluded.updated_at`)
    .run(key, st.id, icao, st.wmo, st.name, st.lat, st.lon, st.elev, st.tz || 'UTC',
         st.hourlyEnd, icao ? 'metar' : null, nowIso, nowIso);
}

// DELETE über alle Stationen, damit ein Spot bei Neuzuordnung nicht doppelt hängt.
function linkSpot(db, key, spot, km) {
  db.prepare('DELETE FROM ml_station_spots WHERE spot_id = ?').run(spot.id);
  db.prepare(`INSERT INTO ml_station_spots (station_key, spot_id, spot_name, spot_lat, spot_lon, km)
              VALUES (?,?,?,?,?,?)`).run(key, spot.id, spot.name, spot.lat, spot.lon, round(km, 1));
}

export function assignStations(db, spots, catalog, opts = {}) {
  const { write = true } = opts;
  const now = opts.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const stations = new Map();
  const assigned = [];
  const unassigned = [];

  for (const spot of spots) {
    const st = pickStation(spot, catalog, { ...opts, now });
    if (!st) { unassigned.push(spot.name); continue; }
    const key = stationKeyOf(st);
    if (!stations.has(key)) stations.set(key, { key, ...st });
    assigned.push({ spotId: spot.id, spotName: spot.name, stationKey: key, label: st.name, km: round(st.km, 1) });
  }

  if (write) {
    const tx = db.transaction(() => {
      for (const st of stations.values()) upsertStation(db, st.key, st, nowIso);
      const byId = new Map(spots.map(s => [s.id, s]));
      for (const a of assigned) linkSpot(db, a.stationKey, byId.get(a.spotId), a.km);
    });
    tx();
  }
  return { stations: [...stations.values()], spots: assigned, unassigned };
}

function rowToStation(r) {
  return {
    key: r.station_key, meteostatId: r.meteostat_id, icao: r.icao, wmo: r.wmo,
    label: r.label, lat: r.lat, lon: r.lon, elev: r.elev, tz: r.tz,
    hourlyEnd: r.hourly_end, liveSource: r.live_source, enabled: !!r.enabled,
  };
}

export function listMlStations(db) {
  const stations = db.prepare('SELECT * FROM ml_stations ORDER BY station_key').all().map(rowToStation);
  const links = db.prepare('SELECT station_key, spot_name, km FROM ml_station_spots ORDER BY km').all();
  for (const st of stations) {
    st.spots = links.filter(l => l.station_key === st.key).map(l => ({ name: l.spot_name, km: l.km }));
    st.km = st.spots.length ? Math.min(...st.spots.map(s => s.km)) : null;
  }
  return stations;
}

function publicStation(st, lat, lon) {
  return { key: st.key, label: st.label, lat: st.lat, lon: st.lon, tz: st.tz,
           km: round(haversineKm(lat, lon, st.lat, st.lon), 1) };
}

function nearestBy(items, distFn) {
  let best = null, bestD = Infinity;
  for (const it of items) {
    const d = distFn(it);
    if (d < bestD) { best = it; bestD = d; }
  }
  return best ? { item: best, km: bestD } : null;
}

export function findMlStationForSpot(db, lat, lon, maxKm = 40) {
  const stations = db.prepare('SELECT * FROM ml_stations WHERE enabled = 1').all().map(rowToStation);
  if (!stations.length) return null;
  const byKey = new Map(stations.map(s => [s.key, s]));

  const links = db.prepare('SELECT station_key, spot_lat, spot_lon FROM ml_station_spots').all()
    .filter(l => byKey.has(l.station_key));
  const link = nearestBy(links, l => haversineKm(lat, lon, l.spot_lat, l.spot_lon));
  if (link && link.km <= SPOT_MATCH_KM) return publicStation(byKey.get(link.item.station_key), lat, lon);

  const near = nearestBy(stations, s => haversineKm(lat, lon, s.lat, s.lon));
  return near && near.km <= maxKm ? publicStation(near.item, lat, lon) : null;
}
