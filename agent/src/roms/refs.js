// ROMS references for the Phase 0 analysis, read straight from the ROMS
// database with SELECTs only. ROMS holds no money — these are the numbers
// staff type by hand (Bill No, CN/DN numbers) and the PO keys they hang off.
//
// Runs on the developer's PC, which has the ROMS credentials; the office PC
// that runs the probe never needs them.
const path = require('path');
const { createClient } = require('@libsql/client');
const { readEnvFile } = require('../util');

const QUERIES = {
  vendors: 'SELECT name, is_active FROM vendors ORDER BY name',
  products: 'SELECT id, sku_code, description, category FROM products ORDER BY sku_code',
  vendorCodes: `SELECT c.vendor, c.vendor_item_code, p.sku_code
                  FROM product_vendor_codes c JOIN products p ON p.id = c.product_id`,
  pos: `SELECT po_id, vendor, vendor_po_id, po_date, status, party_name, city,
               dispatch_date, bill_no, bill_date, grn_status, grn_date, grn_qty, grn_number,
               discrepancy_qty, discrepancy_number, created_at
          FROM marketplace_pos ORDER BY po_id`,
  // The SKU comes the way ROMS maps it: vendor + item code → product.
  lines: `SELECT l.po_id, l.line_no, l.item_code, l.qty, pr.sku_code
            FROM marketplace_po_lines l
            JOIN marketplace_pos p ON p.po_id = l.po_id
            LEFT JOIN product_vendor_codes c ON c.vendor = p.vendor AND c.vendor_item_code = l.item_code
            LEFT JOIN products pr ON pr.id = c.product_id
           ORDER BY l.po_id, l.line_no`,
  rtv: 'SELECT po_id, rtv_no, dn_number, status, delivered, delivery_date, cn_number, cn_date FROM rtv_returns ORDER BY rtv_no',
};

// Where the ROMS database is: --roms-db/--roms-token, else ROMS_DATABASE_URL/
// ROMS_AUTH_TOKEN, else ROMS backend's own .env (TURSO_DATABASE_URL/TOKEN).
function resolveRomsConnection({ romsDb, romsToken, romsEnv, env = process.env } = {}) {
  if (romsDb) return { url: romsDb, authToken: romsToken || undefined };
  if (env.ROMS_DATABASE_URL) return { url: env.ROMS_DATABASE_URL, authToken: env.ROMS_AUTH_TOKEN || undefined };
  if (romsEnv) {
    const vars = readEnvFile(romsEnv);
    let url = vars.TURSO_DATABASE_URL || 'file:./local.db';
    // A relative file: URL in ROMS's .env is relative to the backend folder.
    const m = /^file:(\.{1,2}[/\\].*)$/.exec(url);
    if (m) url = `file:${path.resolve(path.dirname(romsEnv), m[1]).replace(/\\/g, '/')}`;
    return { url, authToken: vars.TURSO_AUTH_TOKEN || undefined };
  }
  throw new Error('Say which ROMS database to read: --roms-env "<ROMS>/backend/.env", or --roms-db <url> [--roms-token <token>].');
}

// libsql://name-org.turso.io?authToken=… → libsql://name-org.turso.io
const redact = (url) => String(url).replace(/[?#].*$/, '').replace(/\/\/[^@/]*@/, '//');

async function readRomsRefs(connection) {
  const db = createClient(connection);
  try {
    const out = { generatedAt: new Date().toISOString(), source: redact(connection.url) };
    for (const [key, sql] of Object.entries(QUERIES)) {
      const res = await db.execute(sql);
      out[key] = res.rows.map((row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]])));
    }
    return out;
  } finally {
    db.close();
  }
}

module.exports = { readRomsRefs, resolveRomsConnection, redact, QUERIES };
