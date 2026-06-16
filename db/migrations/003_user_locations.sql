-- ============================================================================
-- WindFoil Weather Intelligence — Schema Migration 003 (user locations)
-- File version: 1.0.0   |   App target: v3.4.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- WHY:
--   The location picker's "active spot" + "last used" list lived ONLY in the
--   browser's localStorage (wf_loc / wf_loc_recent). iOS Safari silently drops
--   localStorage writes in Private Browsing, with "Block All Cookies" enabled,
--   and purges it via ITP after ~7 days — so manually added spots vanished on
--   reload. This table persists them per authenticated user instead.
--
--   Coordinates are stored rounded to 4 decimals (~11 m) so the UNIQUE
--   constraint dedupes the same spot the way the frontend always has.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_locations (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    latitude     REAL NOT NULL,
    longitude    REAL NOT NULL,
    -- Exactly one row per user may be active (the saved "★ merken" spot).
    is_active    INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
    last_used_at TEXT NOT NULL,                  -- ISO-8601 UTC, orders "recent"
    created_at   TEXT NOT NULL,
    UNIQUE (user_id, latitude, longitude)
);
CREATE INDEX IF NOT EXISTS idx_user_locations_recent
    ON user_locations(user_id, last_used_at DESC);
