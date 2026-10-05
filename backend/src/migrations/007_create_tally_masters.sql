-- The Tally masters RAMS mirrors, per company: groups, ledgers, stock items
-- and voucher types. Keyed by (company, Tally GUID), the same key the
-- Connector pushes, so re-sending a list never duplicates a row.
--
-- The Connector always sends complete lists, so a master missing from one has
-- been deleted in Tally: deleted_at is set rather than the row removed, and a
-- master that comes back is restored. alter_id is Tally's own change counter.
--
-- Names, not ids, link vouchers to masters, because that is how Tally exports
-- them. aliases and gstins are JSON lists.

CREATE TABLE IF NOT EXISTS tally_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES tally_companies(id),
  guid          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  parent        TEXT,
  reserved_name TEXT,
  alter_id      INTEGER,
  deleted_at    TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, guid)
);

CREATE TABLE IF NOT EXISTS tally_ledgers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES tally_companies(id),
  guid         TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  parent       TEXT,
  aliases      TEXT,
  gstin        TEXT,
  gstins       TEXT,
  state        TEXT,
  is_bill_wise INTEGER NOT NULL DEFAULT 0,
  master_id    INTEGER,
  alter_id     INTEGER,
  deleted_at   TEXT,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, guid)
);

CREATE TABLE IF NOT EXISTS tally_stock_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES tally_companies(id),
  guid       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  parent     TEXT,
  aliases    TEXT,
  base_units TEXT,
  hsn        TEXT,
  alter_id   INTEGER,
  deleted_at TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, guid)
);

CREATE TABLE IF NOT EXISTS tally_voucher_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES tally_companies(id),
  guid          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  parent        TEXT,
  reserved_name TEXT,
  numbering     TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  alter_id      INTEGER,
  deleted_at    TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_tally_ledgers_name     ON tally_ledgers(company_id, name);
CREATE INDEX IF NOT EXISTS idx_tally_stock_items_name ON tally_stock_items(company_id, name)
