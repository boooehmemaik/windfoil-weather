-- ============================================================================
-- WindFoil — Schema Migration 013 (ML für alle Spots + historischer Backfill)
-- File version: 1.0.0   |   App target: v3.42.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Bisher lernen Neural-MOS und linearer MOS nur aus live gepollten Daten an
-- fünf fest konfigurierten Stationen; ml_samples wird nach 90 Tagen gepruned.
-- Neue Spots bräuchten so Monate bis zum ersten brauchbaren Modell.
--
--   ml_stations          — automatisch gewählte reale Station je Spot (Meteostat-Katalog)
--   ml_station_spots     — welche Spots von welcher Station bedient werden (n:1)
--   ml_history           — historische Paare Obs ↔ damalige Prognose (lead 0/24/48),
--                          stundengenau, KEIN Pruning (Saison über mehrere Jahre)
--   ml_backfill_progress — Monats-Chunks je Station, damit ein Lauf nach 429
--                          exakt dort weitermacht, wo er abgebrochen wurde
--
-- Additiv: keine bestehende Tabelle wird geändert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_stations (
    station_key   TEXT PRIMARY KEY,          -- ICAO (verbindet mit Live-ml_samples) sonst 'ms:<id>'
    meteostat_id  TEXT,
    icao          TEXT,
    wmo           TEXT,
    label         TEXT    NOT NULL,
    lat           REAL    NOT NULL,
    lon           REAL    NOT NULL,
    elev          REAL,
    tz            TEXT    NOT NULL DEFAULT 'UTC',
    hourly_end    TEXT,                      -- Meteostat inventory.hourly.end (YYYY-MM-DD)
    live_source   TEXT,                      -- 'metar' wenn stündlich live nachgepollt werden kann
    enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS ml_station_spots (
    station_key   TEXT NOT NULL,
    spot_id       TEXT NOT NULL,
    spot_name     TEXT NOT NULL,
    spot_lat      REAL NOT NULL,
    spot_lon      REAL NOT NULL,
    km            REAL NOT NULL,             -- Distanz Spot ↔ Station
    PRIMARY KEY (station_key, spot_id)
);
CREATE INDEX IF NOT EXISTS idx_ml_station_spots_latlon
    ON ml_station_spots(spot_lat, spot_lon);

CREATE TABLE IF NOT EXISTS ml_history (
    station_key     TEXT    NOT NULL,
    ts              TEXT    NOT NULL,        -- UTC 'YYYY-MM-DDTHH:00:00Z' = Zielzeitpunkt der Prognose
    fc_lead_hours   INTEGER NOT NULL,        -- 0 / 24 / 48
    hour_local      INTEGER NOT NULL,        -- 0-23 in Stations-Zeitzone des Zielzeitpunkts
    month           INTEGER NOT NULL,        -- 1-12 des Zielzeitpunkts (lokal)
    obs_wind_ms     REAL,
    obs_gust_ms     REAL,
    obs_dir_deg     REAL,
    fc_wind_ms      REAL,
    fc_dir_deg      REAL,
    fc_pressure_hpa REAL,
    fc_temp_c       REAL,
    fc_cape         REAL,
    fc_ens_wind_ms  REAL,                    -- Ensemble-Median (nur lead 0) für den linearen MOS
    bias_ms         REAL,                    -- obs_wind_ms − fc_wind_ms
    source          TEXT,                    -- 'iem' | 'meteostat'
    PRIMARY KEY (station_key, ts, fc_lead_hours)
);
CREATE INDEX IF NOT EXISTS idx_ml_history_station_lead_ts
    ON ml_history(station_key, fc_lead_hours, ts);

CREATE TABLE IF NOT EXISTS ml_backfill_progress (
    station_key   TEXT    NOT NULL,
    chunk         TEXT    NOT NULL,          -- 'YYYY-MM'
    status        TEXT    NOT NULL,          -- 'done' | 'partial' | 'error'
    rows          INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    updated_at    TEXT    NOT NULL,
    PRIMARY KEY (station_key, chunk)
);
