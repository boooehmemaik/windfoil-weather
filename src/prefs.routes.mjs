// ============================================================================
// WindFoil — User preferences routes (Express)
// File version: 1.0.0 (ESM .mjs)  |  App target: v3.5.0
// Mount:  app.use('/api/prefs', requireAuth, prefsRouter)
// ----------------------------------------------------------------------------
// Generic per-user key/value store for frontend settings that iOS Safari keeps
// dropping from localStorage (Private Browsing / "Block All Cookies" / ITP).
// Deliberately stores the frontend's own JSON blobs verbatim — see migration
// 004 for why these don't reuse rider_profiles / equipment.
// ============================================================================
import { Router } from 'express';
import { db } from './db.mjs';

export const prefsRouter = Router();
const nowIso = () => new Date().toISOString();

// Only these keys may be written — keeps the store from becoming a dumping
// ground and bounds what an authenticated client can persist.
const ALLOWED_KEYS = new Set(['wf_rider', 'wf_gear', 'wf_usegear']);
const MAX_VALUE_BYTES = 16 * 1024; // generous for a gear list; blocks abuse.

// GET /api/prefs -> { wf_rider: <parsed>, wf_gear: <parsed>, ... }
// Only allowlisted keys are returned; bad rows are skipped, never thrown.
prefsRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM user_prefs WHERE user_id = ?').all(req.user.id);
  const out = {};
  for (const row of rows) {
    if (!ALLOWED_KEYS.has(row.key)) continue;
    try { out[row.key] = JSON.parse(row.value); } catch { /* skip corrupt row */ }
  }
  res.json(out);
});

// PUT /api/prefs/:key  body: { value: <any JSON> } -> upsert one setting.
prefsRouter.put('/:key', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'unknown_key' });
  if (!req.body || !('value' in req.body)) return res.status(400).json({ error: 'value_required' });

  const json = JSON.stringify(req.body.value);
  if (json.length > MAX_VALUE_BYTES) return res.status(413).json({ error: 'value_too_large' });

  db.prepare(`INSERT INTO user_prefs (user_id, key, value, updated_at)
              VALUES (?,?,?,?)
              ON CONFLICT(user_id, key) DO UPDATE SET
                value = excluded.value, updated_at = excluded.updated_at`)
    .run(req.user.id, key, json, nowIso());
  res.json({ ok: true, key });
});
