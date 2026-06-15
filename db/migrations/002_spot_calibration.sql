-- ============================================================================
-- WindFoil — Schema Migration 002 (per-spot planing calibration)
-- File version: 1.0.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- The feedback loop must calibrate PER LOCATION: a rider's real lift-off wind
-- at one spot must not skew the score at every other spot. This table holds the
-- rolling planing threshold derived ONLY from that (user, spot) pair's sessions.
-- The rider's global rider_profiles value is intentionally left untouched and
-- serves only as a fallback for spots without local feedback yet.
-- ============================================================================
CREATE TABLE IF NOT EXISTS spot_calibration (
    user_id              TEXT NOT NULL REFERENCES user(id)  ON DELETE CASCADE,
    spot_id              TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    -- Rolling avg of planing_wind_kt over that spot's planed sessions (knots).
    planing_threshold_kt REAL NOT NULL,
    samples              INTEGER NOT NULL DEFAULT 0,
    updated_at           TEXT NOT NULL,
    PRIMARY KEY (user_id, spot_id)
);
CREATE INDEX IF NOT EXISTS idx_spot_calibration_user ON spot_calibration(user_id);
