-- ============================================================================
-- WindFoil — Schema Migration 009 (Forecast Archive für Lead-Time-MOS)
-- File version: 1.0.0   |   App target: v3.28.2   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Speichert bei jedem Stationspoll nicht nur den aktuellen Stundenwert, sondern
-- auch die Modellvorhersage für die nächsten 24 h und 48 h. Damit lässt sich
-- später der echte Vorlaufzeit-Bias berechnen:
--   bias(lead_hours=24, hour=15) = median(obs h15 − fc_wind_ms aus "issued_at" ~h15 von vorgestern)
-- Das ist die Grundlage für vorlaufzeitabhängiges MOS / Neural-MOS (Lead-Feature).
-- Additiv: keine bestehende Tabelle wird geändert.
-- ============================================================================
CREATE TABLE IF NOT EXISTS forecast_archive (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    station_key     TEXT    NOT NULL,
    issued_at       TEXT    NOT NULL,   -- UTC-Zeitstempel des Polls (wann abgerufen)
    target_ts       TEXT    NOT NULL,   -- ISO-8601 UTC der Stunde, für die prognostiziert
    lead_hours      INTEGER NOT NULL,   -- Vorlaufzeit in Stunden (0, 24, 48)
    fc_wind_ms      REAL,
    fc_dir_deg      REAL,
    fc_pressure_hpa REAL,
    fc_temp_c       REAL,
    fc_cape         REAL,
    UNIQUE(station_key, issued_at, lead_hours)
);
CREATE INDEX IF NOT EXISTS idx_fc_archive_target
    ON forecast_archive(station_key, target_ts, lead_hours);
