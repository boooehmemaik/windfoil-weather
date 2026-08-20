-- ============================================================================
-- WindFoil — Schema Migration 007 (MOS: gelernte Stunden-Bias-Korrektur)
-- File version: 1.0.0   |   App target: v3.22.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Ersetzt dort, wo echte Messdaten existieren, die raise-only-Heuristiken
-- (seaBreeze, applyPelerBoost, arome_best_max) durch eine aus Beobachtungen
-- gelernte, VORZEICHENBEHAFTETE Korrektur je Stunde.
-- Additiv: keine bestehende Tabelle wird geändert.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- app_meta — kleiner Key/Value-Speicher für Laufzeit-Marken.
--
-- Erster Nutzer: 'mos_obs_epoch'. Der Obs-Poller schrieb bis einschliesslich
-- Commit 4671dc3 lokale Stundenwerte unter UTC-Indizes weg (Phasenversatz um den
-- UTC-Offset, an Torbole 2 h). Solche Zeilen sind für eine stundenweise
-- Statistik unbrauchbar und NICHT rückwirkend korrigierbar, weil der Offset je
-- Station und Datum (Sommerzeit) variiert.
--
-- Die Marke wird bewusst NICHT als Konstante ins Deployment geschrieben: der
-- Fix wird erst mit dem Service-Neustart aktiv, und wann der passiert, weiss
-- der Code beim Ausrollen nicht. Stattdessen setzt der GEFIXTE Poller die Marke
-- beim ersten Lauf selbst (INSERT OR IGNORE) — sie ist damit per Konstruktion
-- exakt der Zeitpunkt, ab dem die Daten stimmen.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- station_obs_hourly — EIN Sample je (Station, lokaler Tag, lokale Stunde).
--
-- Warum überhaupt eine zweite Tabelle: station_obs wird nach 14 Tagen geprunt
-- und enthält 6 Polls je Stunde, die bei den Tagesserien-Stationen byte-gleich
-- sind. Gemessen: 72 Rohzeilen je (Station, Stunde), aber nur 12 verschiedene
-- Tage. Ohne Verdichtung würde `n` also (a) 72 statt 12 melden und jeden
-- Shrinkage-Faktor n/(n+K) wirkungslos machen, und (b) durch den Prune nie über
-- 14 wachsen — die Annahme "wird mit der Zeit besser" wäre schlicht falsch.
--
-- n_raw bleibt erhalten, um genau diesen Unterschied prüfbar zu halten.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS station_obs_hourly (
    station_key TEXT    NOT NULL,
    local_day   TEXT    NOT NULL,   -- 'YYYY-MM-DD' in Stations-Zeitzone
    hour_local  INTEGER NOT NULL,   -- 0..23 in Stations-Zeitzone
    wind_ms     REAL,               -- Median der Rohwerte dieser Stunde
    gust_ms     REAL,
    n_raw       INTEGER NOT NULL,   -- wie viele Rohzeilen verdichtet wurden
    PRIMARY KEY (station_key, local_day, hour_local)
);
CREATE INDEX IF NOT EXISTS idx_obs_hourly_station_hour
    ON station_obs_hourly(station_key, hour_local);

-- ----------------------------------------------------------------------------
-- station_mos_bias — die gelernte Korrektur.
--
-- bias_ms ist VORZEICHENBEHAFTET. Das ist der Kern: Talamone hat abends real
-- einen negativen Bias (das Modell verspricht Wind, der nicht kommt). Eine
-- raise-only-Korrektur kann das strukturell nicht abbilden — und genau dieser
-- Fall ist der teure, weil er jemanden umsonst an den Strand fahren lässt.
--
-- model_key gehört in den PK: er sagt, WAS korrigiert wird ('ens_median_v1').
-- Ein späterer Wechsel auf ens_median_v2 kann so danebenliegen, ohne die aktive
-- Korrektur zu zerstören.
--
-- n_samples zählt TAGE, nicht Roh-Polls (siehe station_obs_hourly).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS station_mos_bias (
    station_key    TEXT    NOT NULL,
    hour_local     INTEGER NOT NULL,
    model_key      TEXT    NOT NULL,
    bias_ms        REAL    NOT NULL,  -- Median(obs - pred), roh
    bias_shrunk_ms REAL    NOT NULL,  -- geschrumpft + geklemmt; 0 solange n zu klein
    mad_ms         REAL,              -- Median Absolute Deviation = Streuung des Bias
    n_samples      INTEGER NOT NULL,
    obs_median_ms  REAL,
    pred_median_ms REAL,
    window_start   TEXT,
    window_end     TEXT,
    members        TEXT,              -- JSON-Array der beteiligten Modelle
    updated_at     TEXT    NOT NULL,
    PRIMARY KEY (station_key, hour_local, model_key)
);
