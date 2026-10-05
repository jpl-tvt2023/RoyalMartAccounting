-- The Tally vouchers RAMS mirrors, every voucher type, per company.
--
-- Keyed by (company, Tally GUID). An upsert from a newer pull replaces the
-- voucher and ALL its lines, and a pull older than what is stored (a lower
-- AlterID) is ignored. A voucher deleted in Tally is found by the end-of-day
-- check and gets deleted_at, and one that comes back is restored. Row ids stay
-- stable across updates, so later tables can point at them.
--
-- Money is whole paise (INTEGER), so sums and zero checks are exact. Amounts
-- keep Tally's sign: negative is a debit, as is_debit also says. Quantities and
-- rates stay decimal. base_type is the reserved type underneath a custom one
-- (Sales-Zepto is Sales).
--
-- Lines:
--   ledger lines        one per ledger the voucher touches
--   bill allocations    bill-wise New Ref / Agst Ref per ledger line (line_no)
--   inventory lines     stock item, quantity, rate, direction (in / out / blank)
--   orders              the Buyer's Order No and date, which link a sales
--                       invoice to a ROMS PO

CREATE TABLE IF NOT EXISTS tally_vouchers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES tally_companies(id),
  guid           TEXT    NOT NULL,
  master_id      INTEGER,
  alter_id       INTEGER NOT NULL,
  date           TEXT    NOT NULL,
  voucher_type   TEXT    NOT NULL,
  base_type      TEXT    NOT NULL,
  number         TEXT,
  reference      TEXT,
  reference_date TEXT,
  party          TEXT,
  party_gstin    TEXT,
  cmp_gstin      TEXT,
  narration      TEXT,
  is_invoice     INTEGER NOT NULL DEFAULT 0,
  is_cancelled   INTEGER NOT NULL DEFAULT 0,
  is_optional    INTEGER NOT NULL DEFAULT 0,
  total_paise    INTEGER,
  deleted_at     TEXT,
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_run_id    INTEGER REFERENCES tally_sync_runs(id),
  UNIQUE (company_id, guid)
);

CREATE TABLE IF NOT EXISTS tally_vch_ledger_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id   INTEGER NOT NULL REFERENCES tally_vouchers(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  ledger       TEXT    NOT NULL,
  amount_paise INTEGER,
  is_party     INTEGER NOT NULL DEFAULT 0,
  is_debit     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tally_vch_bill_allocations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id   INTEGER NOT NULL REFERENCES tally_vouchers(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  ledger       TEXT,
  name         TEXT,
  bill_type    TEXT,
  amount_paise INTEGER
);

CREATE TABLE IF NOT EXISTS tally_vch_inventory_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id   INTEGER NOT NULL REFERENCES tally_vouchers(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  item         TEXT    NOT NULL,
  qty          REAL,
  unit         TEXT,
  rate         REAL,
  amount_paise INTEGER,
  direction    TEXT,
  godowns      TEXT,
  order_nos    TEXT
);

CREATE TABLE IF NOT EXISTS tally_vch_orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES tally_vouchers(id) ON DELETE CASCADE,
  order_no   TEXT    NOT NULL,
  order_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_tally_vouchers_date   ON tally_vouchers(company_id, date);
CREATE INDEX IF NOT EXISTS idx_tally_vouchers_number ON tally_vouchers(company_id, base_type, number);
CREATE INDEX IF NOT EXISTS idx_tally_vch_ledger_v    ON tally_vch_ledger_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_tally_vch_bills_v     ON tally_vch_bill_allocations(voucher_id);
CREATE INDEX IF NOT EXISTS idx_tally_vch_bills_name  ON tally_vch_bill_allocations(name);
CREATE INDEX IF NOT EXISTS idx_tally_vch_inv_v       ON tally_vch_inventory_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_tally_vch_inv_item    ON tally_vch_inventory_lines(item);
CREATE INDEX IF NOT EXISTS idx_tally_vch_orders_v    ON tally_vch_orders(voucher_id);
CREATE INDEX IF NOT EXISTS idx_tally_vch_orders_no   ON tally_vch_orders(order_no)
