// Everything the engine reads, from RAMS's own tables: the Tally mirror of
// the companies whose sync is on, the copy of ROMS, the rules, and people's
// decisions. A handful of queries -- about 10,000 rows at today's size.
const { SYNC_FROM } = require('../config/env');
const { loadSettings } = require('../services/matchSettings');

const list = (v) => {
  try {
    const out = JSON.parse(v || '[]');
    return Array.isArray(out) ? out : [];
  } catch { return []; }
};

// The date in India, which is what Tally and ROMS dates mean.
const todayIst = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);

async function rowsOf(client, sql, args = []) {
  return (await client.execute({ sql, args })).rows;
}

async function loadInputs(client, { settings, today = todayIst() } = {}) {
  const companies = await rowsOf(client, 'SELECT id, code, gstin FROM tally_companies WHERE sync_enabled = 1');
  const ids = companies.map((c) => Number(c.id));
  const inCompanies = ids.length ? `IN (${ids.join(',')})` : 'IN (NULL)';
  const vchWhere = `v.deleted_at IS NULL AND v.company_id ${inCompanies} AND v.base_type IN ('Sales','Credit Note') AND v.date >= ?`;

  const [vouchers, orders, items, agst, stockItems, ledgers] = await Promise.all([
    rowsOf(client, `SELECT v.id, v.company_id, v.guid, v.date, v.voucher_type, v.base_type, v.number, v.reference, v.party,
                           v.is_cancelled, v.is_optional, v.total_paise
                      FROM tally_vouchers v WHERE ${vchWhere}`, [SYNC_FROM]),
    rowsOf(client, `SELECT o.voucher_id, o.order_no FROM tally_vch_orders o JOIN tally_vouchers v ON v.id = o.voucher_id
                     WHERE ${vchWhere} AND v.base_type = 'Sales'`, [SYNC_FROM]),
    rowsOf(client, `SELECT i.voucher_id, i.item, i.qty FROM tally_vch_inventory_lines i JOIN tally_vouchers v ON v.id = i.voucher_id
                     WHERE ${vchWhere} AND v.base_type = 'Sales'`, [SYNC_FROM]),
    rowsOf(client, `SELECT b.voucher_id, b.name FROM tally_vch_bill_allocations b JOIN tally_vouchers v ON v.id = b.voucher_id
                     WHERE ${vchWhere} AND v.base_type = 'Credit Note' AND b.bill_type = 'Agst Ref' AND b.name IS NOT NULL`, [SYNC_FROM]),
    rowsOf(client, `SELECT company_id, name, aliases FROM tally_stock_items WHERE deleted_at IS NULL AND company_id ${inCompanies}`),
    rowsOf(client, `SELECT company_id, guid, name, gstin, gstins FROM tally_ledgers WHERE deleted_at IS NULL AND company_id ${inCompanies}`),
  ]);

  const byVoucher = (rows, pick) => {
    const m = new Map();
    for (const r of rows) {
      const k = Number(r.voucher_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(pick(r));
    }
    return m;
  };
  const ordersOf = byVoucher(orders, (r) => r.order_no);
  const itemsOf = byVoucher(items, (r) => ({ item: r.item, qty: r.qty }));
  const agstOf = byVoucher(agst, (r) => r.name);

  const [pos, lines, rtv, products, vendorCodes, vendors, partyMap, decisions] = await Promise.all([
    rowsOf(client, 'SELECT po_id, vendor, vendor_po_id, po_date, status, bill_no, bill_date, dispatch_date, grn_status, discrepancy_qty FROM roms_pos'),
    rowsOf(client, 'SELECT po_id, line_no, item_code, qty, sku_code FROM roms_po_lines'),
    rowsOf(client, 'SELECT id, po_id, rtv_no, status, cn_number, cn_date FROM roms_rtv'),
    rowsOf(client, 'SELECT sku_code FROM roms_products'),
    rowsOf(client, 'SELECT vendor_item_code, sku_code FROM roms_vendor_codes'),
    rowsOf(client, 'SELECT vendor, mode FROM match_vendors'),
    rowsOf(client, 'SELECT company_id, ledger_guid, kind, vendor, source FROM party_ledgers'),
    rowsOf(client, `SELECT d.target_kind, d.target_id, d.company_id, d.voucher_guid, d.status, d.decided_at, u.name AS decided_by_name
                      FROM doc_links d LEFT JOIN users u ON u.id = d.decided_by WHERE d.status IN ('confirmed','rejected')`),
  ]);

  return {
    settings: settings || await loadSettings(client),
    today,
    companies: companies.map((c) => ({ id: Number(c.id), code: c.code, gstin: c.gstin })),
    vouchers: vouchers.map((v) => ({
      ...v,
      company_id: Number(v.company_id),
      is_cancelled: Number(v.is_cancelled),
      is_optional: Number(v.is_optional),
      orders: ordersOf.get(Number(v.id)) || [],
      items: itemsOf.get(Number(v.id)) || [],
      agst_refs: agstOf.get(Number(v.id)) || [],
    })),
    stockItems: stockItems.map((s) => ({ company_id: Number(s.company_id), name: s.name, aliases: list(s.aliases) })),
    ledgers: ledgers.map((l) => ({
      company_id: Number(l.company_id), guid: l.guid, name: l.name,
      gstins: [...new Set([l.gstin, ...list(l.gstins)].filter(Boolean))],
    })),
    pos,
    lines,
    rtv: rtv.map((r) => ({ ...r, id: Number(r.id) })),
    products,
    vendorCodes,
    vendors,
    partyMap: partyMap.map((m) => ({ ...m, company_id: Number(m.company_id) })),
    decisions: decisions.map((d) => ({ ...d, company_id: Number(d.company_id) })),
  };
}

module.exports = { loadInputs, todayIst };
