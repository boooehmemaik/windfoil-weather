// ============================================================================
// WindFoil — Analytics routes (Express)
// File version: 1.0.1 (ESM .mjs)  |  App target: v3.5.0
// Mount:  app.use('/api/analytics', requireAuth, analyticsRouter)
// ============================================================================
import { Router } from 'express';
import { db } from './db.mjs';

export const analyticsRouter = Router();

// GET /api/analytics/drift?spot=<id>&source=foil-score
// Predicted (model) vs. actual (rider feedback) per session day — the data the
// DriftChart renders. wind_error_kt > 0 means the model over-predicted wind.
analyticsRouter.get('/drift', (req, res) => {
  const { spot } = req.query;
  const source = req.query.source || 'foil-score';
  if (!spot) return res.status(400).json({ error: 'spot_required' });

  const rows = db.prepare(`
    SELECT s.session_date,
           fs.predicted_score,
           fs.predicted_wind_kt,
           s.planing_wind_kt          AS actual_liftoff_kt,
           s.planed,
           s.rating,
           s.conditions_matched,
           fs.station_model_confidence,
           ROUND(fs.predicted_wind_kt - s.planing_wind_kt, 2) AS wind_error_kt
    FROM sessions s
    JOIN forecast_snapshots fs ON fs.session_id = s.id AND fs.source = ?
    WHERE s.user_id = ? AND s.spot_id = ?
    ORDER BY s.session_date ASC`).all(source, req.user.id, spot);

  // Mean absolute wind error across sessions where the rider actually planed.
  const errs = rows.filter(r => r.wind_error_kt != null).map(r => Math.abs(r.wind_error_kt));
  const mae = errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length) * 100) / 100 : null;

  res.json({ source, spot, sessions: rows.length, meanAbsWindErrorKt: mae, series: rows });
});
