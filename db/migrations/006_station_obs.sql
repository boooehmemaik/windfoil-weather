-- ============================================================================
-- WindFoil — Schema Migration 006 (rolling station observation log)
-- File version: 1.0.0   |   App target: v3.17.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Rolling log echter Stationswerte, befüllt vom Server-Poller alle 10 min.
-- Dient als serverseitige Wahrheit für die Windverhältnisse im Feedback-
-- Zeitfenster (Wing + von/bis statt rider-geschätzter Knoten).
-- Additiv: keine bestehende Tabelle wird geändert.
-- station_key ist ein stabiler menschenlesbarer Bezeichner (z.B. "talamone",
-- "LGPZ") — kein FK, weil die Stationen in proxy-server.js konfiguriert sind.
-- PRIMARY KEY (station_key, ts) verhindert Doppelinserts (INSERT OR IGNORE).
-- ============================================================================
CREATE TABLE IF NOT EXISTS station_obs (
    station_key TEXT NOT NULL,        -- stabiler Schlüssel der Spezial-Station (z.B. "talamone","LGPZ")
    ts          TEXT NOT NULL,        -- ISO-8601 UTC des Messzeitpunkts
    wind_ms     REAL,                 -- Grundwind (m/s)
    gust_ms     REAL,                 -- Böe (m/s)
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    PRIMARY KEY (station_key, ts)
);
CREATE INDEX IF NOT EXISTS idx_station_obs_ts ON station_obs(ts);
