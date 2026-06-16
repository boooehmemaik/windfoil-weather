// ============================================================================
// WindFoil — Equipment routes (Express)
// File version: 1.0.1 (ESM .mjs)  |  App target: v3.5.0
// Mount:  app.use('/api/equipment', requireAuth, equipmentRouter)
// Replaces the old localStorage equipment manager now that gear is per-user.
// ============================================================================
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';

export const equipmentRouter = Router();
const nowIso = () => new Date().toISOString();

// GET /api/equipment -> all of the rider's gear (active first).
equipmentRouter.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM equipment WHERE user_id = ? ORDER BY is_active DESC, kind, size DESC')
    .all(req.user.id);
  res.json(rows);
});

// POST /api/equipment -> add a wing or foil. size is m² (wing) or cm² (foil).
equipmentRouter.post('/', (req, res) => {
  const { kind, name, size } = req.body || {};
  if (!['wing', 'foil'].includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
  if (!name || typeof size !== 'number' || size <= 0)
    return res.status(400).json({ error: 'invalid_equipment' });

  const id = randomUUID();
  db.prepare(`INSERT INTO equipment (id,user_id,kind,name,size,is_active,created_at)
              VALUES (?,?,?,?,?,1,?)`)
    .run(id, req.user.id, kind, name, size, nowIso());
  res.status(201).json({ id, kind, name, size, is_active: 1 });
});

// PATCH /api/equipment/:id -> rename, resize, or toggle active (ownership checked).
equipmentRouter.patch('/:id', (req, res) => {
  const owned = db.prepare('SELECT id FROM equipment WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!owned) return res.status(404).json({ error: 'not_found' });

  const { name, size, isActive } = req.body || {};
  db.prepare(`UPDATE equipment SET
                name = COALESCE(?, name),
                size = COALESCE(?, size),
                is_active = COALESCE(?, is_active)
              WHERE id = ? AND user_id = ?`)
    .run(name ?? null, size ?? null,
         isActive == null ? null : (isActive ? 1 : 0),
         req.params.id, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/equipment/:id -> remove. Sessions referencing it keep the session
// (FK is ON DELETE SET NULL), so history isn't lost.
equipmentRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM equipment WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});
