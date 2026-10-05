-- When the Connector syncs. Set by an Admin or Owner in RAMS (Admin -> Tally
-- companies -> Sync schedule, audited), not in a file on the office PC: the
-- Connector reads it from every heartbeat reply, and its connector.json values
-- only stand in until RAMS has answered once.
--
--   office_days               days of the week, 0 = Sunday ... 6 = Saturday,
--                             comma-separated
--   office_start, office_end  HH:MM on the office PC's clock
--   light_every_minutes       how often the light sync checks, in office hours
--   heavy_after               the end-of-day check runs at the first chance
--                             after this time (or at the next start)
--   backfill_in_office_hours  1 lets a backfill or resync run during office
--                             hours, when Tally is in use
--
-- One row (id = 1), seeded with the defaults agreed on 2026-10-05.

CREATE TABLE IF NOT EXISTS sync_settings (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  office_days              TEXT    NOT NULL DEFAULT '1,2,3,4,5,6',
  office_start             TEXT    NOT NULL DEFAULT '09:00',
  office_end               TEXT    NOT NULL DEFAULT '20:00',
  light_every_minutes      INTEGER NOT NULL DEFAULT 60,
  heavy_after              TEXT    NOT NULL DEFAULT '19:30',
  backfill_in_office_hours INTEGER NOT NULL DEFAULT 0,
  updated_at               TEXT,
  updated_by               INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO sync_settings (id) VALUES (1)
