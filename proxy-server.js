// proxy-server.js v2.6.2
// WindFoil Weather System — Secure backend proxy for real station data
//
// WHY THIS EXISTS
//   A weather API key must never live in browser code. This tiny Node/Express
//   server holds the key server-side, calls Weatherbit, normalizes the response
//   into the shape the frontend expects, and exposes only two safe endpoints:
//       GET /api/station/current?lat=..&lon=..
//       GET /api/station/history?lat=..&lon=..&days=..
//
// SETUP
//   1. npm install express node-fetch@2 cors
//   2. Set your key:  export WEATHERBIT_KEY=your_key_here
//   3. node proxy-server.js   (defaults to port 8787)
//   4. Serve the frontend from the same host so /api/* is same-origin,
//      or put this behind your existing reverse proxy (nginx, Caddy…).
//
// PROVIDER SWAP
//   To use Windy/WU instead, replace the two fetch URLs + the normalize*()
//   functions. The endpoints and JSON contract stay the same, so the frontend
//   needs no changes.

const express = require("express");
const fetch = require("node-fetch"); // v2
const cors = require("cors");
const { execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { mountWindfoil } = require("./src/server.integration.cjs");

// ── Minimal .env loader (no dependency) ───────────────────────────────────────
// Reads KEY=VALUE lines from ./windfoil.env (or path in WF_ENV) into process.env,
// without overwriting variables already set in the real environment.
(function loadEnv() {
  const envPath = process.env.WF_ENV || path.join(__dirname, "windfoil.env");
  try {
    const txt = fs.readFileSync(envPath, "utf8");
    for (const line of txt.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq === -1) continue;
      const k = s.slice(0, eq).trim();
      let v = s.slice(eq + 1).trim();
      // strip optional surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
    console.log("Loaded config from", envPath);
  } catch (e) {
    console.warn("No env file at", envPath, "— using process environment only.");
  }
})();

const app = express();
const PORT = process.env.PORT || 8787;
const KEY = process.env.WEATHERBIT_KEY;

// ── Admin / Deploy config ─────────────────────────────────────────────────────
// ADMIN_TOKEN is the REAL secret — set it to a long random string on the host:
//   export ADMIN_TOKEN=$(openssl rand -hex 24)
// The frontend password ("nuc") is only a convenience gate; the server checks
// the token. Without ADMIN_TOKEN set, all admin endpoints are disabled (403).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ""; // frontend gate, checked server-side
const APP_DIR = process.env.APP_DIR || "/var/www/windfoil";
const DEPLOY_SCRIPT = APP_DIR + "/deploy.sh";

// ── Direct SQLite handle for admin user-management ────────────────────────────
// Better Auth owns the user/account/session tables; this read/write handle to
// the same DB file (WAL allows concurrent connections) powers the admin
// enable/disable + password-reset endpoints. Opened lazily on first use.
const Database = require("better-sqlite3");
const DB_PATH = process.env.WINDFOIL_DB_PATH || path.join(__dirname, "data", "windfoil.db");
let adminDb = null;
function getAdminDb() {
  if (!adminDb) {
    adminDb = new Database(DB_PATH);
    adminDb.pragma("journal_mode = WAL");
    adminDb.pragma("foreign_keys = ON");
    // Mirror the column auth.mjs adds, so this handle works even if it connects first.
    try { adminDb.exec("ALTER TABLE user ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0"); }
    catch (e) { /* column already exists */ }
  }
  return adminDb;
}

// Brute-force protection: lock after too many bad attempts
const adminFails = new Map(); // ip -> { count, until }
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 min

function adminGuard(req, res) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const rec = adminFails.get(ip);
  if (rec && rec.until > now) {
    res.status(429).json({ ok: false, error: "Zu viele Fehlversuche. Bitte später erneut." });
    return null;
  }
  // Token from header (preferred) or query
  const token = req.headers["x-admin-token"] || req.query.token || "";
  if (!ADMIN_TOKEN) {
    res.status(403).json({ ok: false, error: "Admin-Funktionen serverseitig nicht aktiviert (ADMIN_TOKEN fehlt)." });
    return null;
  }
  // Constant-time comparison to avoid timing attacks
  const a = Buffer.from(String(token));
  const b = Buffer.from(ADMIN_TOKEN);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    const f = adminFails.get(ip) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILS) { f.until = now + LOCK_MS; f.count = 0; }
    adminFails.set(ip, f);
    res.status(401).json({ ok: false, error: "Nicht autorisiert." });
    return null;
  }
  adminFails.delete(ip); // reset on success
  return ip;
}

// ── Meteostat station discovery (keyless bulk metadata) ───────────────────────
// Real weather-station list powering the "nearby stations" feature. Meteostat
// has no rate-limited key for the bulk metadata, so we download the global list
// once, cache it on disk + in memory, and refresh weekly. We keep only the few
// fields we need (id/name/country/coords/elevation).
const STATION_LIST_URL = "https://bulk.meteostat.net/v2/stations/lite.json.gz";
// v2 cache filename: schema now also carries `he` (hourly-inventory end date),
// so an older v3.6.0 cache without that field is ignored rather than reused.
const STATION_LIST_FILE = path.join(__dirname, "data", "meteostat-stations-v2.json");
const STATION_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// How many of the nearest stations get upgraded to REAL Weatherbit obs (the rest
// keep the free Open-Meteo model baseline). Kept low: the Weatherbit free tier is
// ~50 calls/day, and exceeding it is what previously blanked the panel.
const NEARBY_MAX_LIVE = parseInt(process.env.NEARBY_MAX_LIVE || "2", 10);

let stationList = null;        // [{id,name,country,lat,lon,elev,he}]
let stationListLoading = null; // in-flight promise, dedupes concurrent loads

function parseStationDump(json) {
  const arr = JSON.parse(json);
  const out = [];
  for (const s of arr) {
    const loc = s && s.location;
    if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") continue;
    out.push({
      id: s.id,
      name: (s.name && (s.name.en || Object.values(s.name)[0])) || s.id,
      country: s.country || "",
      lat: loc.latitude, lon: loc.longitude, elev: loc.elevation ?? null,
      // hourly-inventory end date (or null) — flags stations with usable history.
      he: (s.inventory && s.inventory.hourly && s.inventory.hourly.end) || null,
    });
  }
  return out;
}

async function downloadStationList() {
  const r = await fetch(STATION_LIST_URL);
  if (!r.ok) throw new Error(`Meteostat ${r.status}`);
  const gz = await r.buffer();
  const list = parseStationDump(zlib.gunzipSync(gz).toString("utf8"));
  try { fs.writeFileSync(STATION_LIST_FILE, JSON.stringify(list)); }
  catch (e) { /* read-only fs: keep the list in memory only */ }
  return list;
}

// Lazy, cached accessor. Fresh disk cache wins; otherwise download, falling back
// to a stale disk copy (then an empty list) if the network is down.
function getStationList() {
  if (stationList) return Promise.resolve(stationList);
  if (stationListLoading) return stationListLoading;
  stationListLoading = (async () => {
    try {
      const st = fs.statSync(STATION_LIST_FILE);
      if (Date.now() - st.mtimeMs < STATION_LIST_TTL_MS) {
        // The disk copy is already the minimal {id,name,country,lat,lon,elev} list.
        return (stationList = JSON.parse(fs.readFileSync(STATION_LIST_FILE, "utf8")));
      }
    } catch (e) { /* no usable cache yet */ }
    try {
      stationList = await downloadStationList();
    } catch (e) {
      console.warn("[nearby] station list download failed:", e.message);
      try { stationList = JSON.parse(fs.readFileSync(STATION_LIST_FILE, "utf8")); }
      catch (e2) { stationList = []; }
    }
    return stationList;
  })();
  return stationListLoading.finally(() => { stationListLoading = null; });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Station history bias (real station obs vs model over an overlapping window) ─
// Meteostat hourly bulk is keyless but lags by months and is sparse — useless
// for a "same recent week" mean, but ideal for estimating the model's SYSTEMATIC
// bias at a station, which is time-stable. We compare the station's most recent
// ~45 days of available data against the Open-Meteo archive for the SAME
// dates/hours (both m/s, UTC). Wind in the bulk CSV is km/h → convert to m/s.
const BIAS_WINDOW_DAYS = 45;
const BIAS_MIN_SAMPLES = 50;
const BIAS_MAX_STATION_KM = 60;

async function downloadStationHourly(stationId) {
  const r = await fetch(`https://bulk.meteostat.net/v2/hourly/${stationId}.csv.gz`);
  if (!r.ok) throw new Error(`Meteostat hourly ${r.status}`);
  const csv = zlib.gunzipSync(await r.buffer()).toString("utf8");
  const recs = [];
  for (const line of csv.split("\n")) {
    if (!line) continue;
    const c = line.split(",");
    // cols: 0 date, 1 hour, …, 7 wdir, 8 wspd (km/h), 9 wpgt (km/h)
    if (c[8] === "" || c[8] == null) continue;
    const wind = parseFloat(c[8]) / 3.6;
    if (!Number.isFinite(wind)) continue;
    recs.push({ date: c[0], hour: parseInt(c[1], 10), wind });
  }
  return recs;
}

async function computeStationBias(station) {
  const recs = await downloadStationHourly(station.id);
  if (!recs.length) return { ok: false, error: "no_station_wind" };
  const endD = recs[recs.length - 1].date;
  const ed = new Date(endD + "T00:00:00Z");
  const sd = new Date(ed); sd.setUTCDate(ed.getUTCDate() - BIAS_WINDOW_DAYS);
  const startD = sd.toISOString().slice(0, 10);
  const win = recs.filter(r => r.date >= startD && r.date <= endD);
  if (!win.length) return { ok: false, error: "no_window_data" };

  const p = new URLSearchParams({
    latitude: station.lat, longitude: station.lon,
    start_date: startD, end_date: endD,
    hourly: "windspeed_10m", wind_speed_unit: "ms", timezone: "UTC",
  });
  const ar = await fetch(`https://archive-api.open-meteo.com/v1/archive?${p}`);
  if (!ar.ok) throw new Error(`archive ${ar.status}`);
  const arch = await ar.json();
  const mt = (arch.hourly && arch.hourly.time) || [];
  const mw = (arch.hourly && arch.hourly.windspeed_10m) || [];
  const model = new Map();
  for (let i = 0; i < mt.length; i++) {
    if (mw[i] == null) continue;
    model.set(mt[i].slice(0, 10) + " " + parseInt(mt[i].slice(11, 13), 10), mw[i]);
  }
  let sSum = 0, mSum = 0, n = 0;
  for (const r of win) {
    const m = model.get(r.date + " " + r.hour);
    if (m == null) continue;
    sSum += r.wind; mSum += m; n++;
  }
  if (n < BIAS_MIN_SAMPLES) return { ok: false, error: "insufficient_overlap", samples: n };
  const stationMeanMs = sSum / n, modelMeanMs = mSum / n;
  return {
    ok: true, samples: n, periodStart: startD, periodEnd: endD,
    stationMeanMs: Math.round(stationMeanMs * 100) / 100,
    modelMeanMs: Math.round(modelMeanMs * 100) / 100,
    biasMs: Math.round((stationMeanMs - modelMeanMs) * 100) / 100,
  };
}

if (!KEY) {
  console.warn("⚠️  WEATHERBIT_KEY not set — station endpoints will return 503.");
}

(async () => {
app.use(cors());
// mountWindfoil installs selective json() (skips /api/auth so Better Auth can
// read the raw body), the auth handler, and all /api/* domain routes.
await mountWindfoil(app);

// ── Simple in-memory cache to protect your quota ──────────────────────────────
const cache = new Map();
const CACHE_TTL = { current: 5 * 60_000, history: 60 * 60_000 }; // 5 min / 1 h

function cacheGet(key) {
  const e = cache.get(key);
  if (e && Date.now() < e.exp) return e.val;
  cache.delete(key);
  return null;
}
function cacheSet(key, val, ttl) {
  cache.set(key, { val, exp: Date.now() + ttl });
}

// ── Normalizers: Weatherbit → frontend contract ───────────────────────────────
function normalizeCurrent(json) {
  const d = json && json.data && json.data[0];
  if (!d) return { ok: false, error: "no data" };
  return {
    ok: true,
    station_id: d.station || (json.sources ? json.sources[0] : "n/a"),
    source: (d.sources && d.sources.join(",")) || "weatherbit",
    wind: d.wind_spd,            // m/s
    gust: d.gust ?? d.wind_gust_spd ?? null,
    dir:  d.wind_dir,            // degrees
    temp: d.temp,                // °C
    obs_time: d.ob_time || d.timestamp_local || null,
    lat: json.lat, lon: json.lon,
    city: d.city_name || json.city_name || null,
  };
}

function normalizeHistory(json) {
  if (!json || !Array.isArray(json.data)) return { ok: false, error: "no data" };
  return {
    ok: true,
    station_id: json.station_id || (json.sources ? json.sources[0] : "n/a"),
    source: (json.sources && json.sources.join(",")) || "weatherbit",
    hourly: json.data.map(p => ({
      ts:   p.timestamp_local || p.timestamp_utc,
      wind: p.wind_spd,
      gust: p.wind_gust_spd ?? null,
      dir:  p.wind_dir,
      temp: p.temp,
    })),
  };
}

// Reusable current-observation fetch (cached). Shared by /current and /nearby.
async function weatherbitCurrent(lat, lon) {
  const ck = `cur:${lat}:${lon}`;
  const hit = cacheGet(ck);
  if (hit) return { ...hit, cached: true };
  const url = `https://api.weatherbit.io/v2.0/current?lat=${lat}&lon=${lon}&units=M&key=${KEY}`;
  const r = await fetch(url);
  // 429 (daily quota) returns an empty body — handle it without a JSON throw.
  if (!r.ok) return { ok: false, error: `weatherbit ${r.status}` };
  const j = await r.json();
  const norm = normalizeCurrent(j);
  if (norm.ok) cacheSet(ck, norm, CACHE_TTL.current);
  return norm;
}

// Current wind at many coords in ONE Open-Meteo call (keyless, unlimited).
// Returns a Map "lat,lon" -> {wind,gust,dir,temp} (m/s). Model data, the
// always-available baseline for the nearby panel.
async function openMeteoCurrentBatch(points) {
  if (!points.length) return new Map();
  const p = new URLSearchParams({
    latitude: points.map(s => s.lat).join(","),
    longitude: points.map(s => s.lon).join(","),
    current: "wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m",
    wind_speed_unit: "ms",
  });
  const out = new Map();
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!r.ok) return out;
  const d = await r.json();
  const arr = Array.isArray(d) ? d : [d];
  points.forEach((s, i) => {
    const c = arr[i] && arr[i].current;
    if (c) out.set(`${s.lat},${s.lon}`, {
      wind: c.wind_speed_10m, gust: c.wind_gusts_10m,
      dir: c.wind_direction_10m, temp: c.temperature_2m,
    });
  });
  return out;
}

// ── Real measured-station feed (addicted-sports / profiwetter webcams) ────────
// A handful of spots expose a LIVE anemometer feed (knots, ~10-min sampling)
// behind their webcam "Wetterdaten" graph. We proxy it server-side because the
// endpoint needs a CSRF token + session cookie that the browser can't obtain
// cross-origin. This is real measurement — the ground truth against which our
// Open-Meteo/AROME forecast (the normal chart) can be validated.
const ADDICTED_BASE = "https://en.addicted-sports.com";
const MEASURED_STATIONS = [
  { wc: "torbole", path: "gardasee/torbole", lat: 45.869, lon: 10.873, label: "Torbole (Gardasee)" },
];
const KN_PER_MS = 1.94384; // feed is in knots; we return m/s to match the forecast contract

function findMeasuredStation(lat, lon) {
  for (const s of MEASURED_STATIONS) {
    if (haversineKm(lat, lon, s.lat, s.lon) <= 6) return s;
  }
  return null;
}

// Fetch the webcam page (scrape CSRF token + keep the session cookie), then call
// getWeatherData.php for the given local day. Returns 24 hourly slots in m/s:
// wind = mean of the 10-min wsavg, gust = max wsmax, dir = last sample of the
// hour. Nulls where the day hasn't reached that hour yet (or no sample exists).
async function fetchMeasuredDay(st, dateStr) {
  const [y, m, d] = dateStr.split("-");
  const pageRes = await fetch(`${ADDICTED_BASE}/webcam/${st.path}/`);
  const html = await pageRes.text();
  const tok = (html.match(/name="csrf-token"\s+content="([a-f0-9]+)"/) || [])[1];
  if (!tok) return { ok: false, error: "csrf_unavailable" };
  const cookie = (pageRes.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");

  const api = `${ADDICTED_BASE}/fileadmin/webcam/src/getWeatherData.php`
    + `?startimg=${y}/${m}/${d}/0000&stopimg=${y}/${m}/${d}/2359&graph=true&wc=${encodeURIComponent(st.wc)}`;
  const apiRes = await fetch(api, {
    headers: { CsrfToken: tok, Cookie: cookie, "X-Requested-With": "XMLHttpRequest" },
  });
  const j = await apiRes.json();
  const meas = j && j.measurment; // note: upstream spells it "measurment"
  if (!meas || typeof meas !== "object") return { ok: false, error: "no_measurement" };

  const acc = Array.from({ length: 24 }, () => ({ w: [], g: [], dir: null }));
  let n = 0, latest = null;
  for (const k in meas) {
    const v = meas[k]; const ts = v && v.tsdatetime;
    if (!ts) continue;
    const h = parseInt(ts.slice(11, 13), 10);
    if (!(h >= 0 && h < 24)) continue;
    const wa = parseFloat(v.wsavg), wm = parseFloat(v.wsmax), dd = parseFloat(v.dir);
    if (Number.isFinite(wa)) acc[h].w.push(wa / KN_PER_MS);
    if (Number.isFinite(wm)) acc[h].g.push(wm / KN_PER_MS);
    if (Number.isFinite(dd)) acc[h].dir = Math.round(dd);
    n++; if (!latest || ts > latest) latest = ts;
  }
  const wind = Array(24).fill(null), gust = Array(24).fill(null), dir = Array(24).fill(null);
  for (let h = 0; h < 24; h++) {
    if (acc[h].w.length) wind[h] = Math.round(acc[h].w.reduce((a, b) => a + b, 0) / acc[h].w.length * 100) / 100;
    if (acc[h].g.length) gust[h] = Math.round(Math.max(...acc[h].g) * 100) / 100;
    dir[h] = acc[h].dir;
  }
  return {
    ok: true, wc: st.wc, label: st.label, unit: "ms",
    source: `addicted-sports / profiwetter (${st.label})`,
    date: dateStr, hourly: { wind, gust, dir },
    samples: n, latest: latest ? latest.slice(11, 16) : null,
  };
}

// ── Endpoint: real measured day (ground-truth overlay) ────────────────────────
// GET /api/station/measured?lat=..&lon=..&date=YYYY-MM-DD
// No-ops (ok:false) for spots without a known measured station, so the frontend
// can call it for any location and simply skip the overlay when absent.
app.get("/api/station/measured", async (req, res) => {
  const la = parseFloat(req.query.lat), lo = parseFloat(req.query.lon);
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : null;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || !dateStr)
    return res.status(400).json({ ok: false, error: "lat/lon/date required" });
  const st = findMeasuredStation(la, lo);
  if (!st) return res.json({ ok: false, error: "no_measured_station" });

  const ck = `measured:${st.wc}:${dateStr}`;
  const hit = cacheGet(ck);
  if (hit) return res.json({ ...hit, cached: true });
  try {
    const out = await fetchMeasuredDay(st, dateStr);
    if (out.ok) cacheSet(ck, out, CACHE_TTL.current);
    res.json(out);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── Endpoint: current observation ─────────────────────────────────────────────
app.get("/api/station/current", async (req, res) => {
  if (!KEY) return res.status(503).json({ ok: false, error: "API key not configured" });
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ ok: false, error: "lat/lon required" });
  try {
    res.json(await weatherbitCurrent(lat, lon));
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── Endpoint: real weather stations near a point (Meteostat + Weatherbit) ─────
// Discovery is keyless (Meteostat bulk metadata); current wind for the nearest
// few stations comes from the existing Weatherbit-backed cache (quota-bounded).
// Radius adapts: widen 25→50→75 km until at least 5 stations are found.
app.get("/api/station/nearby", async (req, res) => {
  const { lat, lon } = req.query;
  const la = parseFloat(lat), lo = parseFloat(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo))
    return res.status(400).json({ ok: false, error: "lat/lon required", stations: [] });

  const list = await getStationList();
  if (!list.length)
    return res.json({ ok: false, error: "station list unavailable", stations: [] });

  // Cheap bounding-box prefilter before the haversine pass (lon widens by 1/cos).
  const box = 1.1, lonBox = box / Math.max(0.2, Math.cos(la * Math.PI / 180));
  const withDist = [];
  for (const s of list) {
    if (Math.abs(s.lat - la) > box || Math.abs(s.lon - lo) > lonBox) continue;
    withDist.push({ ...s, distanceKm: haversineKm(la, lo, s.lat, s.lon) });
  }
  withDist.sort((a, b) => a.distanceKm - b.distanceKm);

  let radiusKm = 75, chosen = [];
  for (const rad of [25, 50, 75]) {
    chosen = withDist.filter(s => s.distanceKm <= rad);
    radiusKm = rad;
    if (chosen.length >= 5) break;
  }
  chosen = chosen.slice(0, 8);

  // Baseline: current MODEL wind at every station in one keyless Open-Meteo call,
  // so the panel always has data (src:"model").
  try {
    const model = await openMeteoCurrentBatch(chosen);
    for (const s of chosen) {
      const m = model.get(`${s.lat},${s.lon}`);
      if (m) { s.wind = m.wind; s.gust = m.gust; s.dir = m.dir; s.temp = m.temp; s.src = "model"; }
    }
  } catch (e) { /* stations stay metadata-only */ }

  // Upgrade the nearest few to REAL Weatherbit observations while quota lasts;
  // on any failure (e.g. 429) silently keep the model baseline.
  const liveCount = KEY ? Math.min(NEARBY_MAX_LIVE, chosen.length) : 0;
  await Promise.all(chosen.slice(0, liveCount).map(async (s) => {
    try {
      const cur = await weatherbitCurrent(s.lat, s.lon);
      if (cur && cur.ok) {
        s.wind = cur.wind; s.gust = cur.gust; s.dir = cur.dir;
        s.temp = cur.temp; s.obs_time = cur.obs_time; s.src = "obs";
      }
    } catch (e) { /* keep model baseline */ }
  }));

  res.json({
    ok: true, radiusKm,
    stations: chosen.map(s => ({
      id: s.id, name: s.name, country: s.country,
      lat: s.lat, lon: s.lon, elev: s.elev,
      km: Math.round(s.distanceKm),
      wind: s.wind ?? null, gust: s.gust ?? null, dir: s.dir ?? null,
      temp: s.temp ?? null, obs_time: s.obs_time ?? null,
      src: s.src || null, live: !!s.src,
    })),
  });
});

// ── Endpoint: station-vs-model wind bias (Meteostat history + Open-Meteo archive)
// Picks the nearest real station that has hourly history and returns the
// systematic wind bias over an overlapping window. Cached 24h (bias is stable
// and the source is a multi-MB bulk download).
app.get("/api/station/bias", async (req, res) => {
  const la = parseFloat(req.query.lat), lo = parseFloat(req.query.lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo))
    return res.status(400).json({ ok: false, error: "lat/lon required" });

  const ck = `bias:${la.toFixed(3)}:${lo.toFixed(3)}`;
  const hit = cacheGet(ck);
  if (hit) return res.json({ ...hit, cached: true });

  const list = await getStationList();
  if (!list.length) return res.json({ ok: false, error: "station list unavailable" });

  const box = 1.1, lonBox = box / Math.max(0.2, Math.cos(la * Math.PI / 180));
  const cand = [];
  for (const s of list) {
    if (!s.he) continue; // only stations with hourly history
    if (Math.abs(s.lat - la) > box || Math.abs(s.lon - lo) > lonBox) continue;
    const km = haversineKm(la, lo, s.lat, s.lon);
    if (km <= BIAS_MAX_STATION_KM) cand.push({ ...s, km });
  }
  cand.sort((a, b) => a.km - b.km);

  for (const st of cand.slice(0, 3)) {
    try {
      const b = await computeStationBias(st);
      if (b.ok) {
        const out = {
          station: { id: st.id, name: st.name, country: st.country, km: Math.round(st.km) },
          ...b,
        };
        cacheSet(ck, out, 24 * 60 * 60 * 1000);
        return res.json(out);
      }
    } catch (e) { /* try the next-nearest station */ }
  }
  res.json({ ok: false, error: "no_usable_station_history" });
});

// ── Endpoint: historical hourly observations ──────────────────────────────────
app.get("/api/station/history", async (req, res) => {
  if (!KEY) return res.status(503).json({ ok: false, error: "API key not configured" });
  const { lat, lon } = req.query;
  const days = Math.min(parseInt(req.query.days || "7", 10), 10);
  if (!lat || !lon) return res.status(400).json({ ok: false, error: "lat/lon required" });

  const ck = `hist:${lat}:${lon}:${days}`;
  const hit = cacheGet(ck);
  if (hit) return res.json({ ...hit, cached: true });

  try {
    const end = new Date();
    const start = new Date(); start.setDate(end.getDate() - days);
    const fmt = d => d.toISOString().split("T")[0];
    const url = `https://api.weatherbit.io/v2.0/history/hourly`
      + `?lat=${lat}&lon=${lon}&start_date=${fmt(start)}&end_date=${fmt(end)}`
      + `&units=M&key=${KEY}`;
    const r = await fetch(url);
    const j = await r.json();
    const norm = normalizeHistory(j);
    if (norm.ok) cacheSet(ck, norm, CACHE_TTL.history);
    res.json(norm);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get("/api/station/health", (_req, res) => res.json({ ok: true, keyConfigured: !!KEY }));

// ══ ADMIN ENDPOINTS ══════════════════════════════════════════════════════════
// All require a valid X-Admin-Token. Only whitelisted actions — never arbitrary
// shell. execFile (not exec) prevents shell injection.

// Login: frontend sends the password; server checks it against ADMIN_PASSWORD
// (from the env file) and, only on success, returns the admin token. This keeps
// both the password and the token out of the frontend source code.
app.post("/api/admin/login", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const rec = adminFails.get(ip);
  if (rec && rec.until > now) {
    return res.status(429).json({ ok: false, error: "Zu viele Fehlversuche. Bitte später erneut." });
  }
  if (!ADMIN_PASSWORD || !ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, error: "Admin nicht konfiguriert (ADMIN_PASSWORD/ADMIN_TOKEN fehlen)." });
  }
  const pw = (req.body && req.body.password) || "";
  const a = Buffer.from(String(pw));
  const b = Buffer.from(ADMIN_PASSWORD);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    const f = adminFails.get(ip) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILS) { f.until = now + LOCK_MS; f.count = 0; }
    adminFails.set(ip, f);
    return res.status(401).json({ ok: false, error: "Falsches Passwort." });
  }
  adminFails.delete(ip);
  res.json({ ok: true, token: ADMIN_TOKEN });
});

// Run deploy.sh and stream back the combined output
app.get("/api/admin/deploy", (req, res) => {
  if (!adminGuard(req, res)) return;
  execFile("/usr/bin/sudo", ["/bin/bash", DEPLOY_SCRIPT], { cwd: APP_DIR, timeout: 120000, maxBuffer: 1024 * 1024 },
    (err, stdout, stderr) => {
      res.json({
        ok: !err,
        action: "deploy",
        exitCode: err ? (err.code || 1) : 0,
        output: (stdout || "") + (stderr ? "\n[stderr]\n" + stderr : ""),
      });
    });
});

// Restart the proxy service (systemctl)
app.get("/api/admin/restart-proxy", (req, res) => {
  if (!adminGuard(req, res)) return;
  execFile("/usr/bin/sudo", ["/usr/bin/systemctl", "restart", "windfoil-proxy"], { timeout: 20000 },
    (err, stdout, stderr) => {
      res.json({ ok: !err, action: "restart-proxy", output: err ? (stderr || err.message) : "Proxy neu gestartet." });
    });
});

// Status of services + git revision
app.get("/api/admin/status", (req, res) => {
  if (!adminGuard(req, res)) return;
  execFile("/bin/bash", ["-c",
    "echo '== nginx =='; sudo /usr/bin/systemctl is-active nginx; " +
    "echo '== proxy =='; sudo /usr/bin/systemctl is-active windfoil-proxy; " +
    "echo '== git =='; git -C " + APP_DIR + " log --oneline -3 2>/dev/null; " +
    "echo '== uptime =='; uptime"
  ], { timeout: 15000 }, (err, stdout, stderr) => {
    res.json({ ok: !err, action: "status", output: (stdout || "") + (stderr || "") });
  });
});

// Lightweight check the frontend uses to confirm admin is enabled + token valid
app.get("/api/admin/check", (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ ok: true });
});

// ── User management (Better Auth user/account/session tables) ─────────────────
// List all registered users with their enable/disable state.
app.get("/api/admin/users", (req, res) => {
  if (!adminGuard(req, res)) return;
  try {
    const db = getAdminDb();
    const users = db.prepare(
      "SELECT id, email, name, emailVerified, createdAt, COALESCE(disabled,0) AS disabled " +
      "FROM user ORDER BY createdAt"
    ).all();
    res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Enable/disable a user. Disabling also clears their sessions so the change
// takes effect immediately (and the sign-in hook blocks any new session).
app.post("/api/admin/users/set-disabled", (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = req.body && req.body.id;
  const disabled = req.body && req.body.disabled ? 1 : 0;
  if (!id) return res.status(400).json({ ok: false, error: "User-ID fehlt." });
  try {
    const db = getAdminDb();
    if (!db.prepare("SELECT 1 FROM user WHERE id = ?").get(id)) {
      return res.status(404).json({ ok: false, error: "User nicht gefunden." });
    }
    db.prepare("UPDATE user SET disabled = ?, updatedAt = ? WHERE id = ?")
      .run(disabled, new Date().toISOString(), id);
    if (disabled) db.prepare("DELETE FROM session WHERE userId = ?").run(id);
    res.json({ ok: true, id, disabled });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Reset a user's password. Hashes with Better Auth's own hasher so the new
// password verifies on the next login, then clears sessions to force re-login.
app.post("/api/admin/users/reset-password", async (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = req.body && req.body.id;
  const password = (req.body && req.body.password) || "";
  if (!id) return res.status(400).json({ ok: false, error: "User-ID fehlt." });
  if (String(password).length < 10) {
    return res.status(400).json({ ok: false, error: "Passwort muss mindestens 10 Zeichen haben." });
  }
  try {
    const db = getAdminDb();
    const acct = db.prepare(
      "SELECT id FROM account WHERE userId = ? AND providerId = 'credential'"
    ).get(id);
    if (!acct) return res.status(404).json({ ok: false, error: "Kein Passwort-Konto für diesen User." });
    const { auth } = await import("./src/auth.mjs");
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(String(password));
    const now = new Date().toISOString();
    db.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE id = ?").run(hash, now, acct.id);
    db.prepare("DELETE FROM session WHERE userId = ?").run(id);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});



app.listen(PORT, () => console.log(`WindFoil station proxy on :${PORT} (key ${KEY ? "set" : "MISSING"}, admin ${ADMIN_TOKEN && ADMIN_PASSWORD ? "ENABLED" : "disabled"})`));
})().catch(err => { console.error("[windfoil] startup error:", err); process.exit(1); });
