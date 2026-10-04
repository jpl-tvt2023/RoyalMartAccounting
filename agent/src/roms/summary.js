// What ROMS alone says, before any Tally data exists: when ROMS went live
// (the probe's --from) and the shapes of the numbers staff type by hand.
// 'AA-99-99-999' Bill Nos, for instance, point at Tally numbers like
// 'AA/99-99/999' typed with '-' — the '/' question of the decision gate.
const { mask } = require('../docno');
const { ROMS_REF_RULE } = require('../config');
const { inc, top, pct, mdTable } = require('../util');

const filled = (v) => v != null && String(v).trim() !== '';

function shapes(values) {
  const counts = {}, example = {};
  for (const v of values) {
    const m = mask(v);
    inc(counts, m);
    if (!example[m]) example[m] = String(v).trim();
  }
  return top(counts, 4).map(([m, n]) => ({ mask: m, count: n, example: example[m] }));
}

function summarizeRefs(refs) {
  const live = refs.pos.filter((p) => p.status !== 'Deleted');
  const dates = live.map((p) => p.po_date).filter(filled).sort();
  const vendors = [...new Set(live.map((p) => p.vendor))].sort();
  const byVendor = vendors.map((vendor) => {
    const rows = live.filter((p) => p.vendor === vendor);
    const bills = rows.map((p) => p.bill_no).filter(filled);
    const discrepancies = rows.map((p) => p.discrepancy_number).filter(filled);
    return {
      vendor,
      pos: rows.length,
      firstPoDate: rows.map((p) => p.po_date).filter(filled).sort()[0] || null,
      withBillNo: bills.length,
      withBillDate: rows.filter((p) => filled(p.bill_date)).length,
      billFormats: shapes(bills),
      withDiscrepancy: discrepancies.length,
      discrepancyFormats: shapes(discrepancies),
      vendorPoFormats: shapes(rows.map((p) => p.vendor_po_id).filter(filled)),
    };
  });
  const cns = refs.rtv.map((r) => r.cn_number).filter(filled);
  const dns = refs.rtv.map((r) => r.dn_number).filter(filled);
  const typed = [...live.map((p) => p.bill_no), ...live.map((p) => p.discrepancy_number), ...cns, ...dns].filter(filled);
  return {
    source: refs.source,
    generatedAt: refs.generatedAt,
    livePos: live.length,
    deletedPos: refs.pos.length - live.length,
    firstPoDate: dates[0] || null,
    lastPoDate: dates[dates.length - 1] || null,
    byVendor,
    rtv: { rows: refs.rtv.length, withCn: cns.length, cnFormats: shapes(cns), withDn: dns.length, dnFormats: shapes(dns) },
    // Values ROMS itself would now reject (typed before the rule existed).
    breakingRule: typed.filter((v) => !ROMS_REF_RULE.test(String(v).trim())).length,
    skus: refs.products.length,
    poLines: refs.lines.length,
    poLinesWithoutSku: refs.lines.filter((l) => !filled(l.sku_code)).length,
  };
}

const fmt = (list) => list.map((f) => `\`${f.mask}\` ×${f.count} (${f.example})`).join('<br>') || '—';

function renderRefsSummary(s) {
  return [
    `ROMS ${s.source}, read ${s.generatedAt}: ${s.livePos} live POs (${s.deletedPos} deleted), first PO ${s.firstPoDate || '—'}, last ${s.lastPoDate || '—'}. `
      + `Probe Tally from **${s.firstPoDate || 'the first PO date'}** (\`--from ${s.firstPoDate || 'YYYY-MM-DD'}\`) so every ROMS bill can match.`,
    mdTable(['Vendor', 'Live POs', 'First PO', 'Bill No filled', 'Bill No shapes', 'Discrepancy No shapes', 'Vendor PO shapes'],
      s.byVendor.map((v) => [v.vendor, v.pos, v.firstPoDate || '—', `${v.withBillNo} (${pct(v.withBillNo, v.pos)})`, fmt(v.billFormats), fmt(v.discrepancyFormats), fmt(v.vendorPoFormats)])),
    `RTV: ${s.rtv.rows} rows, ${s.rtv.withCn} with a CN number (${fmt(s.rtv.cnFormats)}), ${s.rtv.withDn} with an RTV DN (${fmt(s.rtv.dnFormats)}). `
      + `${s.breakingRule} typed numbers break ROMS's own letters/digits/'-' rule. ${s.poLinesWithoutSku} of ${s.poLines} PO lines have no SKU mapping; ${s.skus} SKUs.`,
  ].join('\n\n');
}

module.exports = { summarizeRefs, renderRefsSummary };
