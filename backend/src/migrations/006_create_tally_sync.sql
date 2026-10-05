-- Where each company's sync stands, and a log of every sync run.
--
-- tally_sync_state holds the watermarks: the AltVchId / AltMstId counters Tally
-- had when the last successful sync began. They live here, not on the office
-- PC, so reinstalling the Connector loses nothing, and they move only when a
-- run finishes ok -- after RAMS has stored everything that run sent.
--
--   backfill_through   last day of the last month the backfill has stored and
--                      reconciled, so an interrupted backfill resumes after it
--   backfill_alt_*     the counters when the backfill began. They become the
--                      watermarks once it is done, so anything altered during
--                      a long backfill is fetched by the next light sync
--   needs_resync       set when a ledger, stock item or voucher type is
--                      renamed: mirrored voucher lines hold names, and a rename
--                      does not change the vouchers' AlterIDs
--   last_checked_at    the last heartbeat that found Tally's counters equal to
--                      the watermarks, i.e. when RAMS was last known current
--
-- tally_sync_runs is the log. Ingested rows are not audit-logged one by one
-- because the run counts are their record.

CREATE TABLE IF NOT EXISTS tally_sync_state (
  company_id          INTEGER PRIMARY KEY REFERENCES tally_companies(id),
  alt_vch_id          INTEGER,
  alt_mst_id          INTEGER,
  backfill_through    TEXT,
  backfill_done       INTEGER NOT NULL DEFAULT 0,
  backfill_alt_vch_id INTEGER,
  backfill_alt_mst_id INTEGER,
  needs_resync        INTEGER NOT NULL DEFAULT 0,
  last_light_at       TEXT,
  last_heavy_at       TEXT,
  last_checked_at     TEXT,
  updated_at          TEXT
);

CREATE TABLE IF NOT EXISTS tally_sync_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES tally_companies(id),
  agent_id          INTEGER REFERENCES agents(id),
  kind              TEXT    NOT NULL CHECK (kind IN ('light', 'heavy', 'backfill', 'resync')),
  status            TEXT    NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  alt_vch_id        INTEGER,
  alt_mst_id        INTEGER,
  vouchers_upserted INTEGER NOT NULL DEFAULT 0,
  vouchers_skipped  INTEGER NOT NULL DEFAULT 0,
  vouchers_deleted  INTEGER NOT NULL DEFAULT 0,
  masters_upserted  INTEGER NOT NULL DEFAULT 0,
  masters_deleted   INTEGER NOT NULL DEFAULT 0,
  errors            TEXT,
  started_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_company ON tally_sync_runs(company_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status  ON tally_sync_runs(status)
