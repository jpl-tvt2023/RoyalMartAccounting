-- The Tally companies RAMS knows about, one row per Tally company GUID.
--
-- Which companies sync is data, not code. The Connector reports every company
-- it sees loaded in Tally (heartbeat), and each new GUID becomes a row here
-- with sync_enabled = 0. Nothing of its books is read until an Admin or Owner
-- turns sync on (Admin -> Tally companies, audited). A restored backup keeps
-- its GUID, while a company re-created in Tally gets a new GUID and so a new row.
--
-- code is the short label lists show (MH, HR, WB). It defaults from the state
-- and can be edited. gstin is learned from the first vouchers that carry one
-- (CMPGSTIN), and a later batch with a different company GSTIN is refused.
-- Migrations are split on semicolons, so none may appear inside a comment.

CREATE TABLE IF NOT EXISTS tally_companies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guid          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  state_name    TEXT,
  code          TEXT,
  gstin         TEXT,
  books_from    TEXT,
  sync_enabled  INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT,
  updated_at    TEXT,
  updated_by    INTEGER REFERENCES users(id)
)
