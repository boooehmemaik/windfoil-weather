-- ============================================================================
-- WindFoil — Schema Migration 005 (per-spot/wing range calibration)
-- File version: 1.0.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- The scoring feedback loop now captures the WING SIZE and the EXPERIENCED
-- WIND RANGE (low/high knots) per session. This enables a per-(user, spot,
-- wing_m2) rolling calibration of the score window — blended 50/50 with the
-- physics/table result. Fully additive: no existing column is altered.
-- Rückwärtskompatibel: ohne Feedback-Einträge identisches Verhalten zu v3.10.0.
-- ============================================================================

-- sessions: geloggte Wing-Größe + erlebte Wind-Range (unabhängig vom equipment-FK)
ALTER TABLE sessions ADD COLUMN wing_m2       REAL;   -- geflogene Wing-Größe (m²)
ALTER TABLE sessions ADD COLUMN range_low_kt  REAL;   -- unteres Ende (i.d.R. = planing_wind_kt)
ALTER TABLE sessions ADD COLUMN range_high_kt REAL;   -- oberes Ende / "ab hier überpowert" (optional)

-- Rolling per (user, spot, wing_m2): gemittelte erlebte Range.
CREATE TABLE IF NOT EXISTS spot_wing_calibration (
    user_id       TEXT NOT NULL REFERENCES user(id)  ON DELETE CASCADE,
    spot_id       TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    wing_m2       REAL NOT NULL,
    range_low_kt  REAL,            -- AVG der range_low_kt-Samples (kann null sein)
    range_high_kt REAL,            -- AVG der range_high_kt-Samples (kann null sein)
    samples       INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, spot_id, wing_m2)
);
CREATE INDEX IF NOT EXISTS idx_spot_wing_cal_user ON spot_wing_calibration(user_id);
