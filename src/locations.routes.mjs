// ============================================================================
// WindFoil — Location routes (Express)
// File version: 1.0.0 (ESM .mjs)  |  App target: v3.4.0
// Mount:  app.use('/api/locations', requireAuth, locationRouter)
// ----------------------------------------------------------------------------
// Per-user replacement for the wf_loc / wf_loc_recent localStorage keys, which
// iOS Safari silently drops (Private Browsing / "Block All Cookies" / ITP). The
// rolling "last 5 used" list plus the active spot now live in SQLite.
// ============================================================================
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';

export const locationRouter = Router();
const nowIso = () => new Date().toISOString();
const RECENT_LIMIT = 5;

// Match the frontend's historic dedupe granularity (toFixed(4), ~11 m).
const round4 = n => Math.round(Number(n) * 1e4) / 1e4;

// The shape the frontend expects: { active|null, recent:[{name,lat,lon}] }.
function snapshot(userId) {
  const rows = db.prepare(
    `SELECT name, latitude AS lat, longitude AS lon, is_active
       FROM user_locations WHERE user_id = ?
      ORDER BY last_used_at DESC`).all(userId);
  const recent = rows.slice(0, RECENT_LIMIT)
    .map(r => ({ name: r.name, lat: r.lat, lon: r.lon }));
  const activeRow = rows.find(r => r.is_active);
  const active = activeRow
    ? { name: activeRow.name, lat: activeRow.lat, lon: activeRow.lon }
    : null;
  return { active, recent };
}

// GET /api/locations -> the rider's active spot + recent list.
locationRouter.get('/', (req, res) => {
  res.json(snapshot(req.user.id));
});

// POST /api/locations -> remember a spot (dedupe by coords), bump its recency,
// and optionally mark it the active/saved spot. Mirrors the old client-side
// pushRecent (setActive:false) and "★ merken" (setActive:true) behaviour.
locationRouter.post('/', (req, res) => {
  const { lat, lon, name, setActive } = req.body || {};
  const la = round4(lat), lo = round4(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo))
    return res.status(400).json({ error: 'invalid_coords' });
  const nm = (typeof name === 'string' && name.trim()) || `${la}, ${lo}`;
  const now = nowIso();
  const userId = req.user.id;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO user_locations
         (id,user_id,name,latitude,longitude,is_active,last_used_at,created_at)
       VALUES (?,?,?,?,?,0,?,?)
       ON CONFLICT(user_id,latitude,longitude) DO UPDATE SET
         name = excluded.name, last_used_at = excluded.last_used_at`)
      .run(randomUUID(), userId, nm, la, lo, now, now);

    if (setActive) {
      db.prepare('UPDATE user_locations SET is_active = 0 WHERE user_id = ? AND is_active = 1')
        .run(userId);
      db.prepare('UPDATE user_locations SET is_active = 1 WHERE user_id = ? AND latitude = ? AND longitude = ?')
        .run(userId, la, lo);
    }

    // Prune to RECENT_LIMIT, but never drop the active spot even if it's stale.
    const keep = db.prepare(
      `SELECT id FROM user_locations WHERE user_id = ?
        ORDER BY is_active DESC, last_used_at DESC LIMIT ?`)
      .all(userId, RECENT_LIMIT).map(r => r.id);
    if (keep.length) {
      const holes = keep.map(() => '?').join(',');
      db.prepare(`DELETE FROM user_locations WHERE user_id = ? AND id NOT IN (${holes})`)
        .run(userId, ...keep);
    }
  });
  tx();
  res.json(snapshot(userId));
});
