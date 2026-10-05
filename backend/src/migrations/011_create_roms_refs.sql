-- ROMS's references, as RAMS last read them: what matching links Tally to.
-- Read from ROMS's /api/integration/refs (read-only) at every match run, and
-- rewritten only where ROMS changed. ROMS stays the master: nothing here is
-- edited in RAMS. The columns keep ROMS's names (ROMS's
-- integration.controller.js REFS).
--
--   roms_vendors       the marketplaces (Zepto, Blinkit ...)
--   roms_products      SKUs
--   roms_vendor_codes  a marketplace's item code -> SKU (how Tally stock item
--                      names are read: they carry this code)
--   roms_pos           marketplace POs with the Bill No staff typed
--   roms_po_lines      PO lines with the SKU ROMS maps them to
--   roms_rtv           returned-to-vendor rows with the CN No staff typed
--   roms_refresh       one row: when ROMS was last read, and how it went

CREATE TABLE IF NOT EXISTS roms_vendors (
  name      TEXT PRIMARY KEY,
  is_active INTEGER
);

CREATE TABLE IF NOT EXISTS roms_products (
  id          INTEGER PRIMARY KEY,
  sku_code    TEXT,
  description TEXT,
  category    TEXT
);

CREATE TABLE IF NOT EXISTS roms_vendor_codes (
  id               INTEGER PRIMARY KEY,
  vendor           TEXT,
  vendor_item_code TEXT,
  product_id       INTEGER,
  sku_code         TEXT
);

CREATE TABLE IF NOT EXISTS roms_pos (
  po_id              TEXT PRIMARY KEY,
  vendor             TEXT,
  vendor_po_id       TEXT,
  po_date            TEXT,
  status             TEXT,
  party_name         TEXT,
  city               TEXT,
  dispatch_date      TEXT,
  bill_no            TEXT,
  bill_date          TEXT,
  grn_status         TEXT,
  grn_date           TEXT,
  grn_qty            REAL,
  grn_number         TEXT,
  discrepancy_qty    REAL,
  discrepancy_number TEXT,
  created_at         TEXT,
  updated_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_roms_pos_vendor ON roms_pos(vendor);

CREATE TABLE IF NOT EXISTS roms_po_lines (
  po_id     TEXT    NOT NULL,
  line_no   INTEGER NOT NULL,
  item_code TEXT,
  qty       REAL,
  sku_code  TEXT,
  PRIMARY KEY (po_id, line_no)
);

CREATE TABLE IF NOT EXISTS roms_rtv (
  id            INTEGER PRIMARY KEY,
  po_id         TEXT,
  rtv_no        TEXT,
  dn_number     TEXT,
  status        TEXT,
  delivered     INTEGER,
  delivery_date TEXT,
  cn_number     TEXT,
  cn_date       TEXT,
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_roms_rtv_po ON roms_rtv(po_id);

CREATE TABLE IF NOT EXISTS roms_refresh (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_attempt_at TEXT,
  last_ok_at      TEXT,
  last_error      TEXT,
  counts          TEXT
);

INSERT OR IGNORE INTO roms_refresh (id) VALUES (1)
