// Keeps RAMS's copy of ROMS's references (migration 011) up to date: read all
// of ROMS, compare with the copy, and write only the rows that changed. At
// today's size (about 900 POs, 7,000 lines) that is a few writes per run.
const { createRomsClient, romsSettings } = require('./romsClient');

const TABLES = {
  vendors: { table: 'roms_vendors', key: ['name'], cols: ['name', 'is_active'] },
  products: { table: 'roms_products', key: ['id'], cols: ['id', 'sku_code', 'description', 'category'] },
  'vendor-codes': { table: 'roms_vendor_codes', key: ['id'], cols: ['id', 'vendor', 'vendor_item_code', 'product_id', 'sku_code'] },
  pos: {
    table: 'roms_pos',
    key: ['po_id'],
    cols: ['po_id', 'vendor', 'vendor_po_id', 'po_date', 'status', 'party_name', 'city', 'dispatch_date', 'bill_no',
      'bill_date', 'grn_status', 'grn_date', 'grn_qty', 'grn_number', 'discrepancy_qty', 'discrepancy_number',
      'created_at', 'updated_at'],
  },
  lines: { table: 'roms_po_lines', key: ['po_id', 'line_no'], cols: ['po_id', 'line_no', 'item_code', 'qty', 'sku_code'] },
  rtv: {
    table: 'roms_rtv',
    key: ['id'],
    cols: ['id', 'po_id', 'rtv_no', 'dn_number', 'status', 'delivered', 'delivery_date', 'cn_number', 'cn_date', 'updated_at'],
  },
};

const BATCH = 400;
const norm = (v) => (v == null || v === '' ? null : String(v));
const value = (v) => (v === undefined || v === '' ? null : typeof v === 'boolean' ? Number(v) : v);
const keyOf = (spec, row) => spec.key.map((k) => norm(row[k])).join('|');

async function writeBatches(client, stmts) {
  for (let i = 0; i < stmts.length; i += BATCH) await client.batch(stmts.slice(i, i + BATCH), 'write');
}

// Writes one resource's rows over the copy. Returns { rows, written, deleted }.
async function storeResource(client, resource, rows) {
  const spec = TABLES[resource];
  const { rows: stored } = await client.execute(`SELECT ${spec.cols.join(', ')} FROM ${spec.table}`);
  // ROMS answering with nothing where RAMS holds rows is far likelier a wrong
  // address or an empty database than every PO deleted: keep the copy.
  if (!rows.length && stored.length) {
    throw new Error(`ROMS sent no ${resource} although RAMS holds ${stored.length} — the copy was kept. Check ROMS_API_URL.`);
  }
  const before = new Map(stored.map((r) => [keyOf(spec, r), r]));
  const seen = new Set();
  const stmts = [];
  const nonKey = spec.cols.filter((c) => !spec.key.includes(c));
  const upsert = `INSERT INTO ${spec.table} (${spec.cols.join(', ')}) VALUES (${spec.cols.map(() => '?').join(', ')})
                  ON CONFLICT(${spec.key.join(', ')}) DO UPDATE SET ${nonKey.map((c) => `${c} = excluded.${c}`).join(', ')}`;
  for (const row of rows) {
    const k = keyOf(spec, row);
    if (seen.has(k)) continue;
    seen.add(k);
    const old = before.get(k);
    if (old && spec.cols.every((c) => norm(old[c]) === norm(row[c]))) continue;
    stmts.push({ sql: upsert, args: spec.cols.map((c) => value(row[c])) });
  }
  const gone = [...before.entries()].filter(([k]) => !seen.has(k)).map(([, r]) => r);
  for (const r of gone) {
    stmts.push({ sql: `DELETE FROM ${spec.table} WHERE ${spec.key.map((c) => `${c} = ?`).join(' AND ')}`, args: spec.key.map((c) => r[c]) });
  }
  await writeBatches(client, stmts);
  return { rows: seen.size, written: stmts.length - gone.length, deleted: gone.length };
}

// Reads ROMS and refreshes the copy. Never throws for ROMS's sake: the result
// says whether it worked, and matching carries on with the last good copy.
async function refreshRoms(client, { roms, settings = romsSettings() } = {}) {
  if (!roms && !settings.configured) {
    return { ok: false, connected: false, error: 'ROMS isn\'t connected — set ROMS_API_URL and ROMS_INTEGRATION_TOKEN' };
  }
  const reader = roms || createRomsClient(settings);
  await client.execute("UPDATE roms_refresh SET last_attempt_at = datetime('now') WHERE id = 1");
  try {
    const all = await reader.all();
    const counts = {};
    for (const resource of Object.keys(TABLES)) counts[resource] = await storeResource(client, resource, all[resource] || []);
    await client.execute({
      sql: "UPDATE roms_refresh SET last_ok_at = datetime('now'), last_error = NULL, counts = ? WHERE id = 1",
      args: [JSON.stringify(counts)],
    });
    return { ok: true, connected: true, counts };
  } catch (e) {
    await client.execute({ sql: 'UPDATE roms_refresh SET last_error = ? WHERE id = 1', args: [String(e.message).slice(0, 500)] });
    return { ok: false, connected: true, error: e.message };
  }
}

async function refreshState(client) {
  const { rows: [r] } = await client.execute('SELECT * FROM roms_refresh WHERE id = 1');
  return {
    connected: romsSettings().configured,
    last_attempt_at: r?.last_attempt_at ?? null,
    last_ok_at: r?.last_ok_at ?? null,
    last_error: r?.last_error ?? null,
    counts: r?.counts ? JSON.parse(r.counts) : null,
  };
}

module.exports = { refreshRoms, refreshState, storeResource, TABLES };
