-- ============================================================================
-- WindFoil — Alarm-Schwelle wahlweise in Knoten
-- ----------------------------------------------------------------------------
-- min_kn ist nullable. NULL = Score-Modus (bisheriges Verhalten).
-- Ist min_kn gesetzt, wird die Session anhand des mittleren Winds bewertet;
-- min_score bleibt befüllt (DEFAULT 40) und dient als Fallback, falls kein
-- windKn berechnet werden konnte.
-- ============================================================================
ALTER TABLE wind_alerts ADD COLUMN min_kn INTEGER CHECK (min_kn IS NULL OR min_kn BETWEEN 1 AND 60);
