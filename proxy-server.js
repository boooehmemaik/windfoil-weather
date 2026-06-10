// proxy-server.js v2.0.0
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

const app = express();
const PORT = process.env.PORT || 8787;
const KEY = process.env.WEATHERBIT_KEY;

if (!KEY) {
  console.warn("⚠️  WEATHERBIT_KEY not set — station endpoints will return 503.");
}

app.use(cors()); // tighten to your domain in production

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

// ── Endpoint: current observation ─────────────────────────────────────────────
app.get("/api/station/current", async (req, res) => {
  if (!KEY) return res.status(503).json({ ok: false, error: "API key not configured" });
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ ok: false, error: "lat/lon required" });

  const ck = `cur:${lat}:${lon}`;
  const hit = cacheGet(ck);
  if (hit) return res.json({ ...hit, cached: true });

  try {
    const url = `https://api.weatherbit.io/v2.0/current?lat=${lat}&lon=${lon}&units=M&key=${KEY}`;
    const r = await fetch(url);
    const j = await r.json();
    const norm = normalizeCurrent(j);
    if (norm.ok) cacheSet(ck, norm, CACHE_TTL.current);
    res.json(norm);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
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

app.listen(PORT, () => console.log(`WindFoil station proxy on :${PORT} (key ${KEY ? "set" : "MISSING"})`));
