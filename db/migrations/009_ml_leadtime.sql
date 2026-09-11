-- ============================================================================
-- WindFoil — Schema Migration 009 (ML: Lead-Time-Buckets + Forecast-Archiv)
-- File version: 1.0.0   |   App target: v3.28.1   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Zwei Erweiterungen für t+1/t+2-Genauigkeit:
--
--   (a) ml_samples bekommt fc_lead_hours (0/24/48) + UNIQUE auf (station,ts,lead).
--       Die Tabelle ist konstruktionsbedingt leer (Bug erst heute behoben).
--       DROP+CREATE ist deshalb sicher.
--
--   (b) forecast_archive: separates Archiv aller abgefeuerten t+24/t+48-Prognosen
--       (ohne Obs-Matching). Wird von storeFcArchive() befüllt; diente bisher nur
--       als Referenz, wird später für Lead-Time-MOS-Kalibrierung genutzt.
-- ============================================================================

-- (a) ml_samples neu mit fc_lead_hours ───────────────────────────────────────
DROP TABLE IF EXISTS ml_samples;

CREATE TABLE IF NOT EXISTS ml_samples (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    station_key     TEXT    NOT NULL,
    ts              TEXT    NOT NULL,        -- UTC ISO-8601: Zeitpunkt der PROGNOSE (= Obs-Zeit bei lead=0)
    fc_lead_hours   INTEGER NOT NULL DEFAULT 0, -- 0=jetzt, 24=morgen, 48=übermorgen
    hour_local      INTEGER NOT NULL,        -- 0-23 in Stations-Zeitzone des Zielzeitpunkts
    month           INTEGER NOT NULL,        -- 1-12 des Zielzeitpunkts
    -- Beobachtung (non-null nur bei fc_lead_hours=0)
    obs_wind_ms     REAL,
    obs_gust_ms     REAL,
    -- Vorhersage (abgerufen zum Poll-Zeitpunkt, für ts)
    fc_wind_ms      REAL,
    fc_dir_deg      REAL,
    fc_pressure_hpa REAL,
    fc_temp_c       REAL,
    fc_cape         REAL,
    -- Abgeleitet (null bei lead>0)
    bias_ms         REAL,
    UNIQUE(station_key, ts, fc_lead_hours)
);
CREATE INDEX IF NOT EXISTS idx_ml_samples_station_ts
    ON ml_samples(station_key, ts);
CREATE INDEX IF NOT EXISTS idx_ml_samples_station_lead_hour
    ON ml_samples(station_key, fc_lead_hours, hour_local);

-- (b) forecast_archive ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_archive (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    station_key     TEXT    NOT NULL,
    issued_at       TEXT    NOT NULL,   -- UTC ISO: Zeitpunkt des Polls (wann gespeichert)
    target_ts       TEXT    NOT NULL,   -- UTC ISO: Zeitpunkt für den die Prognose gilt
    lead_hours      INTEGER NOT NULL,   -- 24 oder 48
    fc_wind_ms      REAL,
    fc_dir_deg      REAL,
    fc_pressure_hpa REAL,
    fc_temp_c       REAL,
    fc_cape         REAL,
    UNIQUE(station_key, issued_at, lead_hours)
);
CREATE INDEX IF NOT EXISTS idx_fc_archive_station_target
    ON forecast_archive(station_key, target_ts);
