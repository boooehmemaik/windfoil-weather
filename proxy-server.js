// proxy-server.js v2.4.0
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

if (!KEY) {
  console.warn("⚠️  WEATHERBIT_KEY not set — station endpoints will return 503.");
}

app.use(cors());
app.use(express.json()); // tighten to your domain in production

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



app.listen(PORT, () => console.log(`WindFoil station proxy on :${PORT} (key ${KEY ? "set" : "MISSING"}, admin ${ADMIN_TOKEN && ADMIN_PASSWORD ? "ENABLED" : "disabled"})`));
