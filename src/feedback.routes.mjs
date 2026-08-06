// ============================================================================
// WindFoil — Feedback API routes (Express)
// File version: 1.2.0 (ESM .mjs)  |  App target: v3.17.0
// ----------------------------------------------------------------------------
// Mount:  app.use('/api/feedback', requireAuth, feedbackRouter)
// Assumes Better Auth middleware has populated req.user = { id, ... }.
// The "feedback only for today" rule is enforced HERE, server-side, against the
// spot's timezone — the frontend date is never trusted.
// POST /api/feedback body (v1.2.0): { spotId, wingM2, startedAt, endedAt,
//   rating?, conditionsMatched?, notes? }
// Wind-Range wird SERVERSEITIG aus geloggten Stationswerten abgeleitet —
// keine rider-geschätzten Knoten mehr.
// ============================================================================
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, localDay, recalibrateSpotPlaningThreshold, getSpotCalibration, hasEntitlement,
         recalibrateSpotWingRange, getSpotWingCalibration, getObservedWindRange } from './db.mjs';

// ── Station-Key-Lookup: spiegelt findLiveStation / findMeasuredStation aus
// proxy-server.js, ohne dessen Modul hier importieren zu müssen.
// Gibt den stabilen station_key zurück, unter dem der Poller obs speichert.
const SPECIAL_RADIUS_KM = 5;
const STATION_MAP = [
  // LIVE_STATIONS
  { key: "talamone",  lat: 42.554, lon: 11.128, radiusKm: SPECIAL_RADIUS_KM },
  // MEASURED_STATIONS (key = wc || icao || station)
  { key: "torbole",   lat: 45.869, lon: 10.873, radiusKm: SPECIAL_RADIUS_KM },
  { key: "ulcinj",    lat: 41.9166, lon: 19.25293, radiusKm: 12 },
  { key: "LGPZ",      lat: 38.9254, lon: 20.7653, radiusKm: 40 },
];

function haversineKmFR(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function findStationKey(lat, lon) {
  for (const st of STATION_MAP) {
    if (haversineKmFR(lat, lon, st.lat, st.lon) <= st.radiusKm) return st.key;
  }
  return null;
}

export const feedbackRouter = Router();
const nowIso = () => new Date().toISOString();

function getSpot(spotId, userId) {
  // Spot must be global (user_id IS NULL) or owned by the requesting user.
  return db.prepare(
    'SELECT * FROM spots WHERE id = ? AND (user_id IS NULL OR user_id = ?)'
  ).get(spotId, userId);
}

// --- POST /api/feedback/spot --------------------------------------------------
// Bridge for the lat/lon-based frontend: find-or-create a spot for the given
// coordinates so session feedback can be attached. Matches an existing global
// or user-owned spot within ~1 km; otherwise creates a user-owned spot.
// Body: { name?, lat, lon, timezone? }  ->  { spot }
feedbackRouter.post('/spot', (req, res) => {
  const b = req.body || {};
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    return res.status(400).json({ error: 'lat_lon_required' });

  const rlat = Math.round(lat * 10000) / 10000;
  const rlon = Math.round(lon * 10000) / 10000;

  let spot = db.prepare(`
    SELECT * FROM spots
    WHERE (user_id IS NULL OR user_id = ?)
      AND ABS(latitude - ?) < 0.01 AND ABS(longitude - ?) < 0.01
    ORDER BY (user_id IS NULL) ASC
    LIMIT 1`).get(req.user.id, rlat, rlon);

  if (!spot) {
    const id = randomUUID();
    const tz = (typeof b.timezone === 'string' && b.timezone) ? b.timezone : 'UTC';
    const name = (typeof b.name === 'string' && b.name.trim())
      ? b.name.trim().slice(0, 120)
      : `${rlat}°N ${rlon}°E`;
    db.prepare(`INSERT INTO spots (id,user_id,name,latitude,longitude,timezone,created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(id, req.user.id, name, rlat, rlon, tz, nowIso());
    spot = db.prepare('SELECT * FROM spots WHERE id = ?').get(id);
  }
  res.json({ spot, calibration: getSpotCalibration(req.user.id, spot.id),
             wingRanges: getSpotWingCalibration(req.user.id, spot.id) });
});

// --- GET /api/feedback/spot-calibration?lat=&lon= ----------------------------
// Read-only: resolve an EXISTING spot near these coords (never creates one) and
// return its per-spot calibrated planing threshold so the dashboard can apply it
// to the local score. Returns rolling=null when no spot / no local feedback yet.
feedbackRouter.get('/spot-calibration', (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    return res.status(400).json({ error: 'lat_lon_required' });
  const rlat = Math.round(lat * 10000) / 10000;
  const rlon = Math.round(lon * 10000) / 10000;
  const spot = db.prepare(`
    SELECT id FROM spots
    WHERE (user_id IS NULL OR user_id = ?)
      AND ABS(latitude - ?) < 0.01 AND ABS(longitude - ?) < 0.01
    ORDER BY (user_id IS NULL) ASC
    LIMIT 1`).get(req.user.id, rlat, rlon);
  if (!spot) return res.json({ spotId: null, calibration: { rolling: null, samples: 0, scope: 'spot' }, wingRanges: [] });
  res.json({ spotId: spot.id, calibration: getSpotCalibration(req.user.id, spot.id),
             wingRanges: getSpotWingCalibration(req.user.id, spot.id) });
});

// --- GET /api/feedback/today?spot=<id> ---------------------------------------
// Returns today's (spot-local) session/feedback for the user, if any. This is
// the only record the UI is allowed to edit.
feedbackRouter.get('/today', (req, res) => {
  const { spot } = req.query;
  const spotRow = getSpot(spot, req.user.id);
  if (!spotRow) return res.status(404).json({ error: 'spot_not_found' });

  const today = localDay(spotRow.timezone);
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE user_id = ? AND spot_id = ? AND session_date = ?`)
    .get(req.user.id, spot, today);

  res.json({ spotId: spot, timezone: spotRow.timezone, today, session: session || null,
             calibration: getSpotCalibration(req.user.id, spot) });
});

// --- POST /api/feedback -------------------------------------------------------
// Create or update today's feedback (v1.2.0). Body:
//   { spotId, wingM2, startedAt, endedAt,
//     planed?, rating?, conditionsMatched?, notes?, forecast? }
// Wind-Range wird serverseitig aus geloggten station_obs abgeleitet.
// Response: { ok, sessionId, observed, wingCalibration }
feedbackRouter.post('/', (req, res) => {
  const b = req.body || {};
  const spotRow = getSpot(b.spotId, req.user.id);
  if (!spotRow) return res.status(404).json({ error: 'spot_not_found' });

  // --- the gate: only today's spot-local day is writable ---
  const today = localDay(spotRow.timezone);
  if (b.sessionDate && b.sessionDate !== today) {
    return res.status(403).json({ error: 'feedback_locked', reason: 'only_today', today });
  }

  // --- Validierung ---
  if (b.rating != null && (b.rating < 1 || b.rating > 5))
    return res.status(400).json({ error: 'invalid_rating' });
  if (b.conditionsMatched != null && (b.conditionsMatched < 1 || b.conditionsMatched > 5))
    return res.status(400).json({ error: 'invalid_conditions_matched' });
  if (b.planed != null && ![0, 1, true, false].includes(b.planed))
    return res.status(400).json({ error: 'invalid_planed' });
  if (b.wingM2 != null && (typeof b.wingM2 !== 'number' || b.wingM2 <= 0 || b.wingM2 > 20))
    return res.status(400).json({ error: 'invalid_wing_m2' });

  // --- startedAt / endedAt validieren ---
  const startedAt = b.startedAt ?? null;
  const endedAt   = b.endedAt   ?? null;
  if (startedAt && endedAt) {
    const tStart = Date.parse(startedAt), tEnd = Date.parse(endedAt);
    if (isNaN(tStart) || isNaN(tEnd))
      return res.status(400).json({ error: 'invalid_time_window' });
    if (tStart >= tEnd)
      return res.status(400).json({ error: 'start_must_be_before_end' });
    if (tEnd - tStart > 24 * 60 * 60 * 1000)
      return res.status(400).json({ error: 'window_too_long' });
  }

  // --- Wind-Range serverseitig aus Obs ableiten ---
  let obs = null;
  if (startedAt && endedAt) {
    const stationKey = findStationKey(spotRow.latitude, spotRow.longitude);
    if (stationKey) {
      obs = getObservedWindRange(stationKey, startedAt, endedAt);
    }
  }
  const observed     = obs != null;
  const rangeLowKt   = observed ? obs.lowKn  : null;
  const rangeHighKt  = observed ? obs.highKn : null;
  const planingWindKt = observed ? obs.lowKn  : null; // Kompatibilität

  const planed = b.planed == null ? null : (b.planed ? 1 : 0);

  const tx = db.transaction(() => {
    let session = db.prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND spot_id = ? AND session_date = ?')
      .get(req.user.id, b.spotId, today);

    let sessionId;
    if (session) {
      sessionId = session.id;
      db.prepare(`UPDATE sessions SET
          planed=?, planing_wind_kt=?, rating=?, conditions_matched=?, notes=?,
          started_at=COALESCE(?,started_at), ended_at=COALESCE(?,ended_at),
          wing_m2=COALESCE(?,wing_m2), range_low_kt=?, range_high_kt=?,
          updated_at=?
        WHERE id=?`)
        .run(planed, planingWindKt, b.rating ?? null,
             b.conditionsMatched ?? null, b.notes ?? null,
             startedAt, endedAt,
             b.wingM2 ?? null, rangeLowKt, rangeHighKt,
             nowIso(), sessionId);
    } else {
      sessionId = randomUUID();
      db.prepare(`INSERT INTO sessions
          (id,user_id,spot_id,session_date,started_at,ended_at,
           planed,planing_wind_kt,rating,conditions_matched,notes,
           wing_m2,range_low_kt,range_high_kt,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(sessionId, req.user.id, b.spotId, today, startedAt,
             endedAt, planed, planingWindKt, b.rating ?? null,
             b.conditionsMatched ?? null, b.notes ?? null,
             b.wingM2 ?? null, rangeLowKt, rangeHighKt,
             nowIso(), nowIso());
    }

    // Forecast-Snapshot für Drift-Analyse (optional, unverändert).
    if (b.forecast) {
      const f = b.forecast;
      db.prepare(`INSERT INTO forecast_snapshots
          (id,session_id,source,predicted_score,predicted_wind_kt,
           predicted_window_start,predicted_window_end,station_model_confidence,
           raw_json,captured_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), sessionId, f.source || 'foil-score',
             f.predictedScore ?? null, f.predictedWindKt ?? null,
             f.windowStart ?? null, f.windowEnd ?? null,
             f.stationModelConfidence ?? null, JSON.stringify(f.raw ?? {}), nowIso());
    }
    return sessionId;
  });

  const sessionId = tx();
  // Per-Spot-Kalibrierung: nur wenn obs vorhanden (sonst keine Range → kein Effekt)
  const calibration    = recalibrateSpotPlaningThreshold(req.user.id, b.spotId);
  const wingCalibration = recalibrateSpotWingRange(req.user.id, b.spotId);

  res.json({
    ok: true,
    sessionId,
    observed,
    ...(observed ? { obsRange: { lowKn: obs.lowKn, highKn: obs.highKn, samples: obs.samples } } : {}),
    calibration,
    wingCalibration,
  });
});

// --- GET /api/feedback/forecast?spot=<id>&days=N -----------------------------
// Forecast horizon is gated: free = today + 2 days; 'extended_forecast'
// entitlement unlocks more. The actual forecast fetch happens upstream; this
// only decides the allowed horizon (server-side gate, dormant until payments).
feedbackRouter.get('/forecast', (req, res) => {
  const requested = Math.min(parseInt(req.query.days, 10) || 3, 7);
  const maxDays = hasEntitlement(req.user.id, 'extended_forecast') ? 7 : 3;
  res.json({
    grantedDays: Math.min(requested, maxDays),
    capped: requested > maxDays,
    upgradeFeature: requested > maxDays ? 'extended_forecast' : null,
  });
});
