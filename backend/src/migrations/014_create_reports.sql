-- The accounts screens (Reports): Invoices, Credit & debit notes, Stock
-- transfers, Receivables, Exceptions and Sync health. Every figure on them is
-- worked out at read time from the Tally copy (src/books) -- only the settings
-- they use are stored here, set by whoever holds reports.settings (audited).
--
-- report_settings (one row)
--   default_credit_days  credit days for a marketplace without its own terms
--   exception_days       how long a Tally invoice with no PO, or an RTV row with
--                        no credit note, waits before it is an exception
-- vendor_terms          credit days per ROMS vendor. Seeded from the PO terms
--                       noted in the blueprint (Scootsy 5, Now 45, Minutes 15).
-- sync_requests         "Sync now": a person asks for a light sync of one
--                       company (or every company). The heartbeat passes it to
--                       the Connector, and the next sync run of that company
--                       marks it done.
--
-- No semicolons may appear in these comments -- migrate.js splits on them.

CREATE TABLE IF NOT EXISTS report_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  default_credit_days INTEGER NOT NULL DEFAULT 30,
  exception_days      INTEGER NOT NULL DEFAULT 15,
  updated_at          TEXT,
  updated_by          INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO report_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS vendor_terms (
  vendor      TEXT PRIMARY KEY,
  credit_days INTEGER NOT NULL,
  updated_at  TEXT,
  updated_by  INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO vendor_terms (vendor, credit_days) VALUES ('Scootsy', 5), ('Now', 45), ('Minutes', 15);

CREATE TABLE IF NOT EXISTS sync_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER REFERENCES tally_companies(id),
  kind         TEXT    NOT NULL DEFAULT 'light' CHECK (kind IN ('light')),
  requested_by INTEGER REFERENCES users(id),
  requested_at TEXT    NOT NULL DEFAULT (datetime('now')),
  done_at      TEXT,
  run_id       INTEGER REFERENCES tally_sync_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_sync_requests_open ON sync_requests(done_at);

-- Who may see and change them, agreed with the M7 plan: Accountants see the
-- reports, set credit terms and press Sync now. Viewers see the reports.
INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
  ('Accountant', 'reports.view'),
  ('Accountant', 'reports.settings'),
  ('Accountant', 'sync.run'),
  ('Viewer', 'reports.view')
