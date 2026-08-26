-- ============================================================================
-- WindFoil — Schema Migration 008 (ML: gepaarte Forecast+Observation-Samples)
-- File version: 1.0.0   |   App target: v3.28.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Speichert bei jedem Stationspoll sowohl die echte Beobachtung als auch die
-- gleichzeitige Open-Meteo-Vorhersage für dieselbe Koordinate. Diese Paare
-- sind das Trainings-Dataset für:
--   (a) Neuronales MOS: MLP lernt Bias-Korrektur aus mehreren Forecast-Features
--   (b) Meltemi-Klassifikator: MLP klassifiziert ob Meltemi >=7 m/s bei LGPZ
--
-- Retention: 90 Tage (vs. 14 Tage für rohe station_obs) — braucht mehr History
-- um neuronale Modelle zu stützen.
-- Additiv: keine bestehende Tabelle wird geändert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_samples (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    station_key     TEXT    NOT NULL,
    ts              TEXT    NOT NULL,        -- UTC ISO-8601 Zeitstempel des Polls
    hour_local      INTEGER NOT NULL,        -- 0-23 in Stations-Zeitzone
    month           INTEGER NOT NULL,        -- 1-12
    -- Beobachtung (echte Station)
    obs_wind_ms     REAL    NOT NULL,
    obs_gust_ms     REAL,
    -- Vorhersage (Open-Meteo, diese Koordinate, diese Stunde, abgerufen zur Pollzeit)
    fc_wind_ms      REAL,
    fc_dir_deg      REAL,
    fc_pressure_hpa REAL,
    fc_temp_c       REAL,
    fc_cape         REAL,
    -- Abgeleitet
    bias_ms         REAL,                   -- obs_wind_ms - fc_wind_ms (negativ = Modell zu hoch)
    UNIQUE(station_key, ts)
);
CREATE INDEX IF NOT EXISTS idx_ml_samples_station_ts
    ON ml_samples(station_key, ts);
CREATE INDEX IF NOT EXISTS idx_ml_samples_station_hour
    ON ml_samples(station_key, hour_local);
