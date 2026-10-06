-- Auto-fill: RAMS writes Tally's numbers into the ROMS fields they belong in --
-- the Builty Bill No + Bill Date of a linked PO, and the Credit Note No + CN
-- Date of a linked RTV row -- through ROMS's POST /api/integration/autofill.
-- ROMS compares each field with the value RAMS read (expected) and refuses if
-- a person changed it since, runs its own checks, and records the change in
-- its history as "Tally Sync". Nothing else in ROMS is ever written.
--
-- autofill_settings (one row), set on Matching -> Auto-fill by whoever holds
-- autofill.settings (audited)
--   bill_mode, cn_mode   off      nothing is sent to ROMS
--                        preview  ROMS is asked what would happen (a dry run)
--                                 and nothing is written
--                        approve  as preview, then a person approves and RAMS
--                                 writes
--                        auto     written after every match
--                        Off until the office has watched it in preview.
--   replace_typed        rewrite a typed form of Tally's number (607 or 0607
--                        becomes 607/RM/26-27). Anything else staff typed is
--                        only ever replaced by a person (autofill.overwrite).
--   bill_date_rule       tally = the Bill Date becomes the invoice's date in
--                        Tally, keep = a Bill Date staff typed is kept and only
--                        a blank one is filled
--
-- autofill_items       the open work, one row per PO or RTV row: what RAMS
--                      read in ROMS (expected), what it will write (value,
--                      date) and how far it got (state). A row goes once ROMS
--                      holds the value. state:
--                        to_check  new, or changed since ROMS last answered
--                        checked   ROMS's dry run says it would accept it
--                        to_write  a person approved it
--                        refused   ROMS refused (reason). Not sent again until
--                                  the value or ROMS's field changes, or a
--                                  person presses Try again
--                        differs   ROMS holds something that is not a form of
--                                  Tally's number -- only a person writes it
-- autofill_events      every real answer from ROMS (applied, skipped as
--                      already so, rejected), kept for good: the "Written" log
-- autofill_runs        each round of sending to ROMS, one at a time
--
-- No semicolons may appear in these comments -- migrate.js splits on them.

CREATE TABLE IF NOT EXISTS autofill_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  bill_mode      TEXT    NOT NULL DEFAULT 'off' CHECK (bill_mode IN ('off','preview','approve','auto')),
  cn_mode        TEXT    NOT NULL DEFAULT 'off' CHECK (cn_mode IN ('off','preview','approve','auto')),
  replace_typed  INTEGER NOT NULL DEFAULT 1,
  bill_date_rule TEXT    NOT NULL DEFAULT 'tally' CHECK (bill_date_rule IN ('tally','keep')),
  updated_at     TEXT,
  updated_by     INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO autofill_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS autofill_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger     TEXT    NOT NULL CHECK (trigger IN ('connector','manual','cli')),
  user_id     INTEGER REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  counts      TEXT,
  error       TEXT,
  ms          INTEGER,
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS autofill_items (
  target_kind   TEXT    NOT NULL CHECK (target_kind IN ('po','rtv')),
  target_id     TEXT    NOT NULL,
  po_id         TEXT    NOT NULL,
  field         TEXT    NOT NULL CHECK (field IN ('bill_no','cn_number')),
  kind          TEXT    NOT NULL CHECK (kind IN ('fill','replace','date','differs')),
  expected      TEXT,
  expected_date TEXT,
  value         TEXT    NOT NULL,
  date          TEXT    NOT NULL,
  company_id    INTEGER,
  state         TEXT    NOT NULL CHECK (state IN ('to_check','checked','to_write','refused','differs')),
  reason        TEXT,
  dry           INTEGER NOT NULL DEFAULT 0,
  approved_by   INTEGER REFERENCES users(id),
  approved_at   TEXT,
  tries         INTEGER NOT NULL DEFAULT 0,
  tried_at      TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_autofill_items_state ON autofill_items(target_kind, state);

CREATE TABLE IF NOT EXISTS autofill_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER REFERENCES autofill_runs(id),
  target_kind TEXT    NOT NULL CHECK (target_kind IN ('po','rtv')),
  target_id   TEXT    NOT NULL,
  po_id       TEXT    NOT NULL,
  field       TEXT    NOT NULL,
  kind        TEXT,
  old_value   TEXT,
  new_value   TEXT,
  old_date    TEXT,
  new_date    TEXT,
  result      TEXT    NOT NULL CHECK (result IN ('applied','skipped','rejected')),
  reason      TEXT,
  by_user     INTEGER REFERENCES users(id),
  at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_autofill_events_target ON autofill_events(target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_autofill_events_at     ON autofill_events(at);

-- match_runs.sync_mark: the last Tally sync run that had finished when the
-- match started. A sync run after it that stored changes makes the next match
-- due. Comparing times missed a sync that finished in the same second as a
-- match began (the times are to the second).
ALTER TABLE match_runs ADD COLUMN sync_mark INTEGER;

-- Who may see and approve it, agreed on 2026-10-06: Accountants see and
-- approve, Viewers see. Overwriting a value staff typed and changing the
-- modes stay with Admin and Owner until they grant them.
INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
  ('Accountant', 'autofill.view'),
  ('Accountant', 'autofill.approve'),
  ('Viewer', 'autofill.view')
