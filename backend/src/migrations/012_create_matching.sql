-- Matching: which Tally invoice settles each ROMS PO, and which Tally credit
-- note each RTV row. The rules are data, set on Matching -> Matching rules by
-- whoever holds matching.rules (audited), with the defaults the Phase 0 data
-- supported. Nothing here is written to ROMS -- that is auto-fill (M6).
--
-- match_settings (one row)
--   use_order_no, order_no_drop_label, order_no_split
--       find the invoice by the Buyer's Order No it carries, also with a label
--       after a dash dropped (P4588464- Dry), also each of several numbers (A/B)
--   use_bill_no, bill_no_serial
--       find it by the Bill No staff typed, also a digits-only Bill No against
--       the invoice's serial (607 or 0607 for 607/RM/26-27)
--   number_strength      exact, normalised (separators and leading zeros
--                        ignored) or compact (letters and digits only)
--   pick_same_date, pick_same_fy
--                        when a number is on several invoices, take the one on
--                        the Bill Date, then the only one in the same FY
--   bill_only_links      linked or review: a link found by Bill No alone
--   check_*              off, note or review, for each check on a link
--   qty_tolerance_pct, date_tolerance_days   slack for the quantity and date
--                        checks
--   cn_agst_ref, cn_number
--                        link a credit note settling the PO's invoice, and one
--                        whose number is the CN No typed on the RTV row
--   grace_days           a typed Bill No or CN No missing from Tally waits this
--                        long (Tally may not be written up yet) before review
--   excluded_voucher_types   JSON list of Tally voucher type names that never
--                        count as invoices or credit notes
--   run_every_minutes    how often matching runs in office hours
--
-- match_vendors        per ROMS vendor: match, transfer (a stock transfer, no
--                      linking key yet) or skip. A vendor not listed is match.
-- party_ledgers        per Tally party ledger (company + ledger GUID, so a
--                      rename keeps it): the marketplace it belongs to, our own
--                      registration (internal) or not a marketplace (other).
--                      source person = set by someone, gstin = found from the
--                      ledger's GSTIN carrying one of our companies' PAN.
--                      suggested_* = what the last run's links point to.
-- match_runs           each matching run
-- doc_links            PO -> invoice and RTV -> credit note links. auto = the
--                      engine's, confirmed or rejected = a person's decision,
--                      which every later run respects.
-- match_results        the latest status of every PO and RTV row, with the
--                      reason, the explanation (detail) and what auto-fill
--                      would write (fill)

CREATE TABLE IF NOT EXISTS match_settings (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  use_order_no           INTEGER NOT NULL DEFAULT 1,
  order_no_drop_label    INTEGER NOT NULL DEFAULT 1,
  order_no_split         INTEGER NOT NULL DEFAULT 1,
  use_bill_no            INTEGER NOT NULL DEFAULT 1,
  bill_no_serial         INTEGER NOT NULL DEFAULT 1,
  number_strength        TEXT    NOT NULL DEFAULT 'compact' CHECK (number_strength IN ('exact','normalised','compact')),
  pick_same_date         INTEGER NOT NULL DEFAULT 1,
  pick_same_fy           INTEGER NOT NULL DEFAULT 1,
  bill_only_links        TEXT    NOT NULL DEFAULT 'linked' CHECK (bill_only_links IN ('linked','review')),
  check_party            TEXT    NOT NULL DEFAULT 'review' CHECK (check_party IN ('off','note','review')),
  check_sku              TEXT    NOT NULL DEFAULT 'review' CHECK (check_sku IN ('off','note','review')),
  check_qty              TEXT    NOT NULL DEFAULT 'note' CHECK (check_qty IN ('off','note','review')),
  qty_tolerance_pct      INTEGER NOT NULL DEFAULT 0,
  check_date             TEXT    NOT NULL DEFAULT 'note' CHECK (check_date IN ('off','note','review')),
  date_tolerance_days    INTEGER NOT NULL DEFAULT 0,
  check_split            TEXT    NOT NULL DEFAULT 'note' CHECK (check_split IN ('off','note','review')),
  check_reused           TEXT    NOT NULL DEFAULT 'review' CHECK (check_reused IN ('off','note','review')),
  cn_agst_ref            INTEGER NOT NULL DEFAULT 1,
  cn_number              INTEGER NOT NULL DEFAULT 1,
  grace_days             INTEGER NOT NULL DEFAULT 7,
  excluded_voucher_types TEXT    NOT NULL DEFAULT '[]',
  run_every_minutes      INTEGER NOT NULL DEFAULT 60,
  updated_at             TEXT,
  updated_by             INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO match_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS match_vendors (
  vendor     TEXT PRIMARY KEY,
  mode       TEXT NOT NULL DEFAULT 'match' CHECK (mode IN ('match','transfer','skip')),
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);

-- Phase 0: ROMS's Flipkart and Amazon rows are stock transfers with no Bill
-- No, and their linking key is still open. Changeable on the rules page.
INSERT OR IGNORE INTO match_vendors (vendor, mode) VALUES ('Flipkart', 'transfer'), ('Amazon', 'transfer');

CREATE TABLE IF NOT EXISTS party_ledgers (
  company_id       INTEGER NOT NULL REFERENCES tally_companies(id),
  ledger_guid      TEXT    NOT NULL,
  kind             TEXT    CHECK (kind IN ('vendor','internal','other')),
  vendor           TEXT,
  source           TEXT    CHECK (source IN ('person','gstin')),
  suggested_vendor TEXT,
  suggested_votes  INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT,
  updated_by       INTEGER REFERENCES users(id),
  PRIMARY KEY (company_id, ledger_guid)
);

CREATE TABLE IF NOT EXISTS match_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger     TEXT    NOT NULL CHECK (trigger IN ('connector','manual','settings','cli')),
  user_id     INTEGER REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  roms_ok     INTEGER,
  roms_error  TEXT,
  counts      TEXT,
  error       TEXT,
  ms          INTEGER,
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS doc_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind  TEXT    NOT NULL CHECK (target_kind IN ('po','rtv')),
  target_id    TEXT    NOT NULL,
  role         TEXT    NOT NULL CHECK (role IN ('invoice','credit_note')),
  company_id   INTEGER NOT NULL REFERENCES tally_companies(id),
  voucher_guid TEXT    NOT NULL,
  method       TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','confirmed','rejected')),
  decided_by   INTEGER REFERENCES users(id),
  decided_at   TEXT,
  run_id       INTEGER REFERENCES match_runs(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (target_kind, target_id, company_id, voucher_guid)
);

CREATE INDEX IF NOT EXISTS idx_doc_links_voucher ON doc_links(company_id, voucher_guid);

CREATE TABLE IF NOT EXISTS match_results (
  target_kind    TEXT    NOT NULL CHECK (target_kind IN ('po','rtv')),
  target_id      TEXT    NOT NULL,
  po_id          TEXT    NOT NULL,
  outcome        TEXT    NOT NULL CHECK (outcome IN ('linked','review','waiting','not_matched')),
  reason         TEXT,
  method         TEXT,
  vendor         TEXT,
  company_id     INTEGER,
  voucher_guid   TEXT,
  voucher_number TEXT,
  voucher_date   TEXT,
  detail         TEXT,
  fill           TEXT,
  outcome_since  TEXT    NOT NULL DEFAULT (datetime('now')),
  run_id         INTEGER REFERENCES match_runs(id),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_match_results_outcome ON match_results(target_kind, outcome)
