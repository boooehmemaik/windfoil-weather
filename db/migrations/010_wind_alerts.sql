-- ============================================================================
-- WindFoil — Windalarm (Plan B, Feature 1)
-- ----------------------------------------------------------------------------
-- Drei Tabellen: wer will was (wind_alerts), wohin wird geliefert
-- (push_subscriptions), was wurde schon geschickt (wind_alert_sent).
-- ============================================================================

CREATE TABLE IF NOT EXISTS wind_alerts (
  user_id    TEXT    NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  spot_id    TEXT    NOT NULL,
  min_score  INTEGER NOT NULL DEFAULT 70 CHECK (min_score BETWEEN 1 AND 100),
  created_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, spot_id)
);

-- Der Scheduler liest spaltenweise über alle Nutzer, nicht pro Nutzer.
CREATE INDEX IF NOT EXISTS idx_wind_alerts_spot ON wind_alerts(spot_id);

-- Der Endpunkt ist der Primärschlüssel, nicht die user_id: ein Nutzer darf
-- Handy und Laptop gleichzeitig abonniert haben. fail_count erlaubt das
-- Aufräumen toter Abos, auch wenn der Push-Dienst kein 410 liefert.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  ua         TEXT,
  created_at TEXT    NOT NULL,
  last_ok_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Entprellung: ein Alarm je Nutzer, Spot und Tag. Der Score wird mitgeschrieben,
-- damit eine spätere Version bei deutlicher Verbesserung erneut melden kann.
CREATE TABLE IF NOT EXISTS wind_alert_sent (
  user_id TEXT    NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  spot_id TEXT    NOT NULL,
  day     TEXT    NOT NULL,
  score   INTEGER NOT NULL,
  sent_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, spot_id, day)
);

-- Aufräumen läuft über das Datum, nicht über den Nutzer.
CREATE INDEX IF NOT EXISTS idx_wind_alert_sent_day ON wind_alert_sent(day);
