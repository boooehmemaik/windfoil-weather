-- ============================================================================
-- WindFoil — Session-Logbuch (Plan B, Feature 2)
-- File version: 1.0.0   |   App target: v3.32.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- Das Logbuch braucht kein neues Schema: `sessions` (001_init) und
-- `forecast_snapshots` (001_init) tragen die Daten schon. Es fehlt nur die
-- Unterscheidung, ob ein Eintrag am Tag der Session entstand oder nachgetragen
-- wurde — bis zu sieben Tage sind ab v3.32.0 erlaubt.
--
-- Warum eine eigene Spalte und nicht `created_at > session_date` rechnen:
-- `session_date` ist der Kalendertag in der Zeitzone des Spots, `created_at`
-- ein UTC-Zeitstempel. Der Vergleich bräuchte die Spot-Zeitzone und wäre um
-- Mitternacht falsch. Beim Schreiben ist die Ortszeit bekannt — dort gehört
-- die Entscheidung hin, nicht in jede späteren Abfrage.
--
-- Additiv: keine bestehende Spalte wird geändert.
-- ============================================================================

ALTER TABLE sessions ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0;

-- Die Liste im Logbuch geht über alle Spots eines Nutzers, absteigend nach Tag.
-- idx_sessions_user_date (001_init) deckt das ab; der Teilindex hier bedient
-- zusätzlich die Qualitätsfrage „welche Einträge sind nachgetragen?", ohne die
-- Haupttabelle zu scannen.
CREATE INDEX IF NOT EXISTS idx_sessions_backfilled
    ON sessions(user_id, session_date) WHERE backfilled = 1;
