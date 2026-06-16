// ============================================================================
// WindFoil — Profile routes (Express)
// File version: 1.0.1 (ESM .mjs)  |  App target: v3.7.0
// Mount:  app.use('/api/profile', requireAuth, profileRouter)
// ============================================================================
import { Router } from 'express';
import { db } from './db.mjs';

export const profileRouter = Router();
const nowIso = () => new Date().toISOString();

// GET /api/profile -> rider profile (or a default skeleton if none yet).
profileRouter.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM rider_profiles WHERE user_id = ?').get(req.user.id);
  res.json(row || {
    user_id: req.user.id, weight_kg: null, skill_level: null,
    planing_threshold_kt: null, planing_threshold_source: 'default',
  });
});

// PATCH /api/profile -> update weight / skill (general profile fields).
profileRouter.patch('/', (req, res) => {
  const { weightKg, skillLevel } = req.body || {};
  if (skillLevel && !['beginner','intermediate','advanced','expert'].includes(skillLevel))
    return res.status(400).json({ error: 'invalid_skill_level' });

  db.prepare(`INSERT INTO rider_profiles (user_id, weight_kg, skill_level, updated_at)
              VALUES (?,?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET
                weight_kg = COALESCE(excluded.weight_kg, weight_kg),
                skill_level = COALESCE(excluded.skill_level, skill_level),
                updated_at = excluded.updated_at`)
    .run(req.user.id, weightKg ?? null, skillLevel ?? null, nowIso());
  res.json({ ok: true });
});

// PATCH /api/profile/threshold -> set planing threshold.
//   source 'manual'      = the rider typed it (won't be auto-overwritten)
//   source 'calibrated'  = rider accepted the feedback-derived suggestion
//                          (future feedback keeps refining it)
profileRouter.patch('/threshold', (req, res) => {
  const { planingThresholdKt, source = 'manual' } = req.body || {};
  if (typeof planingThresholdKt !== 'number' || planingThresholdKt <= 0)
    return res.status(400).json({ error: 'invalid_threshold' });
  if (!['manual', 'calibrated'].includes(source))
    return res.status(400).json({ error: 'invalid_source' });

  db.prepare(`INSERT INTO rider_profiles
                (user_id, planing_threshold_kt, planing_threshold_source, updated_at)
              VALUES (?,?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET
                planing_threshold_kt = excluded.planing_threshold_kt,
                planing_threshold_source = excluded.planing_threshold_source,
                updated_at = excluded.updated_at`)
    .run(req.user.id, planingThresholdKt, source, nowIso());
  res.json({ ok: true, planingThresholdKt, source });
});
