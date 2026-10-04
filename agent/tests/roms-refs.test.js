// roms-refs against a local throwaway SQLite file shaped like ROMS (only the
// columns RAMS reads). Never touches a remote database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@libsql/client');
const { readRomsRefs, resolveRomsConnection, redact } = require('../src/roms/refs');
const { summarizeRefs, renderRefsSummary } = require('../src/roms/summary');
const { buildDataset } = require('../mock/dataset');

const SCHEMA = `
CREATE TABLE vendors (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER);
CREATE TABLE products (id INTEGER PRIMARY KEY, sku_code TEXT, description TEXT, category TEXT);
CREATE TABLE product_vendor_codes (id INTEGER PRIMARY KEY, product_id INTEGER, vendor TEXT, vendor_item_code TEXT);
CREATE TABLE marketplace_pos (po_id TEXT PRIMARY KEY, vendor TEXT, vendor_po_id TEXT, po_date TEXT, status TEXT,
  party_name TEXT, city TEXT, dispatch_date TEXT, bill_no TEXT, bill_date TEXT, grn_status TEXT, grn_date TEXT,
  grn_qty INTEGER, grn_number TEXT, discrepancy_qty INTEGER, discrepancy_number TEXT, created_at TEXT);
CREATE TABLE marketplace_po_lines (id INTEGER PRIMARY KEY, po_id TEXT, line_no INTEGER, item_code TEXT, qty INTEGER);
CREATE TABLE rtv_returns (id INTEGER PRIMARY KEY, po_id TEXT, rtv_no TEXT, dn_number TEXT, status TEXT, delivered TEXT,
  delivery_date TEXT, cn_number TEXT, cn_date TEXT);
INSERT INTO vendors (name, is_active) VALUES ('Zepto', 1), ('Blinkit', 1);
INSERT INTO products (id, sku_code) VALUES (1, 'RMB-RED-01'), (2, 'RMB-BLU-01');
INSERT INTO product_vendor_codes (product_id, vendor, vendor_item_code) VALUES (1, 'Zepto', 'Z-RED'), (2, 'Blinkit', 'Z-RED');
INSERT INTO marketplace_pos (po_id, vendor, vendor_po_id, po_date, status, bill_no) VALUES
  ('Z001', 'Zepto', 'ZPO-1', '2026-04-02', 'Open', 'RM-26-27-001'), ('Z002', 'Zepto', 'ZPO-2', '2026-04-03', 'Deleted', NULL);
INSERT INTO marketplace_po_lines (po_id, line_no, item_code, qty) VALUES ('Z001', 1, 'Z-RED', 10), ('Z001', 2, 'Z-NEW', 3);
INSERT INTO rtv_returns (po_id, rtv_no, cn_number) VALUES ('Z001', 'ZR001', 'CN-1');
`;

test('reads POs (Deleted included, for the analysis to exclude), lines with SKUs the way ROMS maps them, RTV rows', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rams-roms-')), 'roms.db').replace(/\\/g, '/');
  const db = createClient({ url: `file:${file}` });
  await db.executeMultiple(SCHEMA);
  db.close();

  const refs = await readRomsRefs({ url: `file:${file}` });
  expect(refs.pos.map((p) => [p.po_id, p.status, p.bill_no])).toEqual([['Z001', 'Open', 'RM-26-27-001'], ['Z002', 'Deleted', null]]);
  // Z-RED maps through Zepto's code, not Blinkit's; an unmapped code has no SKU.
  expect(refs.lines.map((l) => [l.item_code, l.sku_code])).toEqual([['Z-RED', 'RMB-RED-01'], ['Z-NEW', null]]);
  expect(refs.rtv).toEqual([expect.objectContaining({ po_id: 'Z001', rtv_no: 'ZR001', cn_number: 'CN-1' })]);
  expect(refs.products).toHaveLength(2);
  expect(refs.vendors.map((v) => v.name)).toEqual(['Blinkit', 'Zepto']);
});

test('connection: explicit flag, then ROMS_* env, then ROMS backend .env (relative file: resolved to its folder)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rams-env-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'TURSO_DATABASE_URL=file:./local.db\nTURSO_AUTH_TOKEN=\n');
  expect(resolveRomsConnection({ romsDb: 'libsql://a.turso.io', romsToken: 't', romsEnv: envFile })).toEqual({ url: 'libsql://a.turso.io', authToken: 't' });
  expect(resolveRomsConnection({ romsEnv: envFile, env: { ROMS_DATABASE_URL: 'libsql://b.turso.io' } }).url).toBe('libsql://b.turso.io');
  expect(resolveRomsConnection({ romsEnv: envFile, env: {} })).toEqual({ url: `file:${path.join(dir, 'local.db').replace(/\\/g, '/')}`, authToken: undefined });
  expect(() => resolveRomsConnection({ env: {} })).toThrow(/--roms-env/);
});

test('summary: go-live date and the shapes of hand-typed numbers, deleted POs left out', () => {
  const s = summarizeRefs(buildDataset().romsRefs);
  expect(s).toMatchObject({ livePos: 11, deletedPos: 1, firstPoDate: '2026-04-02', lastPoDate: '2026-06-10', breakingRule: 0, poLinesWithoutSku: 1 });
  const zepto = s.byVendor.find((v) => v.vendor === 'Zepto');
  expect(zepto).toMatchObject({ pos: 8, withBillNo: 8 });
  expect(zepto.billFormats[0]).toEqual({ mask: 'AA-99-99-999', count: 5, example: 'RM-26-27-001' });
  expect(s.rtv).toMatchObject({ rows: 2, withCn: 1, withDn: 1 });
  expect(renderRefsSummary(s)).toContain('--from 2026-04-02');
});

test('redact drops tokens and credentials from a URL', () => {
  expect(redact('libsql://db-org.turso.io?authToken=secret')).toBe('libsql://db-org.turso.io');
  expect(redact('https://user:pw@db-org.turso.io/x')).toBe('https://db-org.turso.io/x');
});
