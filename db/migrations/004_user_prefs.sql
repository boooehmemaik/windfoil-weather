-- ============================================================================
-- WindFoil Weather Intelligence — Schema Migration 004 (user prefs)
-- File version: 1.0.0   |   App target: v3.4.0   |   Engine: SQLite 3
-- ----------------------------------------------------------------------------
-- WHY:
--   The rider profile (wf_rider), gear setups (wf_gear) and the auto-setup
--   toggle (wf_usegear) lived ONLY in browser localStorage, which iOS Safari
--   silently drops (Private Browsing / "Block All Cookies" / ITP purge).
--
--   These shapes don't map onto rider_profiles / equipment cleanly (the gear
--   "setup" bundles wing+foil+threshold under a name; skill uses 'pro' not
--   'expert'; wingSize/foilFront have no column there). Rather than lossily
--   reshape them — and risk the server-side calibration loop that owns those
--   tables — we persist the frontend's own blobs verbatim in a generic,
--   per-user key/value store. localStorage stays only as an offline cache.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,                 -- allowlisted by the API
    value      TEXT NOT NULL,                 -- JSON-encoded payload
    updated_at TEXT NOT NULL,                 -- ISO-8601 UTC
    PRIMARY KEY (user_id, key)
);
