// The accounts as RAMS reads them from the Tally copy, worked out at read time
// -- nothing here is stored, following ROMS's "nothing derivable is stored".
//
// Each live sales invoice since RAMS_SYNC_FROM, in a company whose sync is on,
// with what settled it. Tally keeps a receivable bill-wise: the invoice opens
// a bill on the party ledger (a New Ref, a debit, so negative), and receipts,
// credit notes and journals settle it with Agst Ref allocations of the same
// name on the same party ledger (credits, positive). So
//   outstanding = -(the sum of every allocation of that bill)
// and each settling voucher's base type says what it was: a receipt, a credit
// note, a TDS journal (one with a TDS ledger) or another adjustment.
//
// Taxable value and GST come from the invoice's ledger lines, by the group each
// ledger sits under in Tally (Sales Accounts, Duties & Taxes). The marketplace
// is the linked PO's vendor, else the party ledger's mapping (Matching -> Party
// ledgers), else its suggestion. Sales to our own registrations are stock
// transfers and stay out of receivables.
const { SYNC_FROM } = require('../config/env');
const { todayIst } = require('../matching/load');

const BUCKETS = [
  { key: 'd0_30', label: '0–30 days', max: 30 },
  { key: 'd31_60', label: '31–60 days', max: 60 },
  { key: 'd61_90', label: '61–90 days', max: 90 },
  { key: 'd90_plus', label: '90+ days', max: Infinity },
];

const rowsOf = async (client, sql, args = []) => (await client.execute({ sql, args })).rows;
const n = (v) => (v == null ? 0 : Number(v));
const lower = (s) => String(s || '').toLowerCase();
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const bucketOf = (age) => BUCKETS.find((b) => age <= b.max).key;

async function loadSettings(client) {
  const [{ rows: [s] }, { rows: terms }] = await Promise.all([
    client.execute('SELECT r.*, u.name AS updated_by_name FROM report_settings r LEFT JOIN users u ON u.id = r.updated_by WHERE r.id = 1'),
    client.execute('SELECT vendor, credit_days FROM vendor_terms'),
  ]);
  return {
    default_credit_days: n(s.default_credit_days),
    exception_days: n(s.exception_days),
    updated_at: s.updated_at ?? null,
    updated_by_name: s.updated_by_name ?? null,
    terms: Object.fromEntries(terms.map((t) => [t.vendor, n(t.credit_days)])),
  };
}

// group name -> the reserved groups above it, per company.
function groupChains(groups) {
  const byCompany = new Map();
  for (const g of groups) {
    const k = Number(g.company_id);
    if (!byCompany.has(k)) byCompany.set(k, new Map());
    byCompany.get(k).set(lower(g.name), g);
  }
  return (companyId, groupName) => {
    const map = byCompany.get(Number(companyId)) || new Map();
    const out = [];
    const seen = new Set();
    for (let g = map.get(lower(groupName)); g && !seen.has(lower(g.name)); g = map.get(lower(g.parent))) {
      seen.add(lower(g.name));
      out.push(g.reserved_name || g.name);
    }
    if (!out.length && groupName) out.push(groupName);
    return out;
  };
}

async function loadBook(client, { today = todayIst() } = {}) {
  const companies = await rowsOf(client, 'SELECT id, code, name FROM tally_companies WHERE sync_enabled = 1');
  const ids = companies.map((c) => Number(c.id));
  const inCompanies = ids.length ? `IN (${ids.join(',')})` : 'IN (NULL)';
  const live = `v.deleted_at IS NULL AND v.is_cancelled = 0 AND v.is_optional = 0 AND v.company_id ${inCompanies} AND v.date >= ?`;
  const kinds = "('Sales','Credit Note','Debit Note','Receipt','Journal')";

  const [settings, vouchers, lines, bills, groups, ledgers, parties, links, results] = await Promise.all([
    loadSettings(client),
    rowsOf(client, `SELECT v.id, v.company_id, v.guid, v.date, v.voucher_type, v.base_type, v.number, v.party, v.total_paise
                      FROM tally_vouchers v WHERE ${live} AND v.base_type IN ${kinds}`, [SYNC_FROM]),
    rowsOf(client, `SELECT l.voucher_id, l.ledger, l.amount_paise, l.is_party FROM tally_vch_ledger_lines l JOIN tally_vouchers v ON v.id = l.voucher_id
                     WHERE ${live} AND v.base_type IN ('Sales','Journal')`, [SYNC_FROM]),
    rowsOf(client, `SELECT b.voucher_id, b.ledger, b.name, b.bill_type, b.amount_paise FROM tally_vch_bill_allocations b JOIN tally_vouchers v ON v.id = b.voucher_id
                     WHERE ${live} AND v.base_type IN ${kinds}`, [SYNC_FROM]),
    rowsOf(client, `SELECT company_id, name, parent, reserved_name FROM tally_groups WHERE deleted_at IS NULL AND company_id ${inCompanies}`),
    rowsOf(client, `SELECT company_id, guid, name, parent FROM tally_ledgers WHERE deleted_at IS NULL AND company_id ${inCompanies}`),
    rowsOf(client, 'SELECT company_id, ledger_guid, kind, vendor, source, suggested_vendor FROM party_ledgers'),
    rowsOf(client, `SELECT d.target_id AS po_id, d.company_id, d.voucher_guid, p.vendor FROM doc_links d LEFT JOIN roms_pos p ON p.po_id = d.target_id
                     WHERE d.target_kind = 'po' AND d.status IN ('auto','confirmed')`),
    rowsOf(client, "SELECT po_id, outcome FROM match_results WHERE target_kind = 'po'"),
  ]);

  const code = new Map(companies.map((c) => [Number(c.id), c.code || c.name]));
  const chainOf = groupChains(groups);
  const ledgerOf = new Map(ledgers.map((l) => [`${Number(l.company_id)}|${lower(l.name)}`, l]));
  const chainOfLedger = (companyId, name) => {
    const l = ledgerOf.get(`${Number(companyId)}|${lower(name)}`);
    return l ? chainOf(companyId, l.parent) : [];
  };
  const partyOf = new Map(parties.map((p) => [`${Number(p.company_id)}|${p.ledger_guid}`, p]));
  const outcomeOf = new Map(results.map((r) => [r.po_id, r.outcome]));
  const posOf = new Map();
  for (const l of links) {
    const k = `${Number(l.company_id)}|${l.voucher_guid}`;
    if (!posOf.has(k)) posOf.set(k, []);
    if (outcomeOf.get(l.po_id) === 'linked') posOf.get(k).push({ po_id: l.po_id, vendor: l.vendor });
  }

  const byId = new Map(vouchers.map((v) => [Number(v.id), v]));
  const linesOf = new Map();
  for (const l of lines) {
    const k = Number(l.voucher_id);
    if (!linesOf.has(k)) linesOf.set(k, []);
    linesOf.get(k).push(l);
  }
  const isTdsJournal = new Set([...linesOf.entries()]
    .filter(([id, ls]) => byId.get(id)?.base_type === 'Journal' && ls.some((l) => /\bTDS\b/i.test(l.ledger)))
    .map(([id]) => id));

  // Every allocation, by bill: company | party ledger | bill name.
  const billKey = (companyId, ledger, name) => `${Number(companyId)}|${lower(ledger)}|${String(name).trim()}`;
  const allocations = new Map();
  const onAccount = new Map(); // company | ledger -> credits not set against a bill
  for (const b of bills) {
    const v = byId.get(Number(b.voucher_id));
    if (!v) continue;
    if (b.bill_type === 'On Account' && b.ledger) {
      const k = `${Number(v.company_id)}|${lower(b.ledger)}`;
      onAccount.set(k, (onAccount.get(k) || 0) + n(b.amount_paise));
      continue;
    }
    if (!b.name || !b.ledger) continue;
    const k = billKey(v.company_id, b.ledger, b.name);
    if (!allocations.has(k)) allocations.set(k, []);
    allocations.get(k).push({ voucher: v, type: b.bill_type, amount: n(b.amount_paise) });
  }

  const newRefsOf = new Map();
  for (const b of bills) {
    if (b.bill_type !== 'New Ref' || !b.name) continue;
    const k = Number(b.voucher_id);
    if (!newRefsOf.has(k)) newRefsOf.set(k, []);
    newRefsOf.get(k).push(b);
  }

  const invoices = [];
  for (const v of vouchers) {
    if (v.base_type !== 'Sales') continue;
    const id = Number(v.id);
    const companyId = Number(v.company_id);
    const own = (newRefsOf.get(id) || []).filter((b) => lower(b.ledger) === lower(v.party));
    const names = own.length ? [...new Set(own.map((b) => String(b.name).trim()))] : [];
    const ls = linesOf.get(id) || [];
    let taxable = 0;
    let gst = 0;
    for (const l of ls) {
      if (l.is_party) continue;
      const chain = chainOfLedger(companyId, l.ledger);
      if (chain.includes('Duties & Taxes')) gst += n(l.amount_paise);
      else if (chain.includes('Sales Accounts')) taxable += n(l.amount_paise);
    }
    const total = Math.abs(n(v.total_paise));
    if (!taxable && total) taxable = total - gst;

    const settled = { received: 0, credit_notes: 0, tds: 0, adjustments: 0 };
    const settledBy = [];
    let balance = null;
    if (names.length) {
      balance = 0;
      for (const name of names) {
        for (const a of allocations.get(billKey(companyId, v.party, name)) || []) {
          balance += a.amount;
          if (Number(a.voucher.id) === id) continue;
          const bt = a.voucher.base_type;
          const field = bt === 'Receipt' ? 'received' : bt === 'Credit Note' ? 'credit_notes' : bt === 'Journal' && isTdsJournal.has(Number(a.voucher.id)) ? 'tds' : 'adjustments';
          settled[field] += a.amount;
          settledBy.push({
            base_type: bt, voucher_type: a.voucher.voucher_type, number: a.voucher.number, date: a.voucher.date, amount_paise: a.amount, as: field,
          });
        }
      }
    }
    const outstanding = balance == null ? null : -balance;

    const ledger = ledgerOf.get(`${companyId}|${lower(v.party)}`);
    const mapping = ledger ? partyOf.get(`${companyId}|${ledger.guid}`) : null;
    const pos = posOf.get(`${companyId}|${v.guid}`) || [];
    const internal = Boolean(mapping && mapping.kind === 'internal' && mapping.source);
    let vendor = null;
    let vendorFrom = null;
    if (pos.length && pos[0].vendor) { vendor = pos[0].vendor; vendorFrom = 'po'; } else if (mapping && mapping.kind === 'vendor' && mapping.vendor) { vendor = mapping.vendor; vendorFrom = 'ledger'; } else if (mapping && mapping.suggested_vendor) { vendor = mapping.suggested_vendor; vendorFrom = 'suggested'; }

    const creditDays = vendor && settings.terms[vendor] != null ? settings.terms[vendor] : settings.default_credit_days;
    const due = addDays(v.date, creditDays);
    const age = Math.max(0, daysBetween(v.date, today));
    const open = outstanding != null && outstanding > 0;
    invoices.push({
      key: `${companyId}|${v.guid}`,
      company_id: companyId,
      company: code.get(companyId),
      guid: v.guid,
      number: v.number,
      date: v.date,
      voucher_type: v.voucher_type,
      party: v.party,
      vendor,
      vendor_from: vendorFrom,
      internal,
      pos: pos.map((p) => p.po_id),
      bills: names,
      total_paise: total,
      taxable_paise: taxable,
      gst_paise: gst,
      ...Object.fromEntries(Object.entries(settled).map(([k, a]) => [`${k}_paise`, a])),
      outstanding_paise: outstanding,
      settled_by: settledBy,
      credit_days: creditDays,
      due_date: due,
      age_days: age,
      bucket: bucketOf(age),
      overdue_days: open && today > due ? daysBetween(due, today) : 0,
      status: outstanding == null ? 'not_billwise' : open ? (today > due ? 'overdue' : 'open') : 'settled',
    });
  }

  // Credits on a party ledger not set against any bill, by company | ledger.
  const unallocated = [];
  for (const [k, amount] of onAccount) {
    if (!amount) continue;
    const [companyId, name] = [Number(k.split('|')[0]), k.slice(k.indexOf('|') + 1)];
    const ledger = ledgerOf.get(`${companyId}|${name}`);
    if (!ledger || !chainOf(companyId, ledger.parent).includes('Sundry Debtors')) continue;
    const mapping = partyOf.get(`${companyId}|${ledger.guid}`);
    if (mapping && mapping.kind === 'internal') continue;
    const vendor = mapping && mapping.kind === 'vendor' ? mapping.vendor : mapping?.suggested_vendor || null;
    unallocated.push({ company_id: companyId, company: code.get(companyId), ledger: ledger.name, vendor, amount_paise: amount });
  }

  return {
    today, settings, companies: companies.map((c) => ({ id: Number(c.id), code: c.code, name: c.name })), invoices, unallocated, vouchers, bills, byId,
  };
}

// Per marketplace and company: what was invoiced, how it was settled, what is
// still owed and how old it is. Stock transfers are left out. Money received
// On Account (not set against a bill -- marketplaces often pay into a
// head-office ledger) is shown apart, and net outstanding takes it off.
function receivables(book, { companyId = null } = {}) {
  const rows = new Map();
  const blank = (vendor, company) => ({
    vendor, company_id: company.id, company: company.code, invoices: 0, open_invoices: 0, invoiced_paise: 0, received_paise: 0, credit_notes_paise: 0,
    tds_paise: 0, adjustments_paise: 0, outstanding_paise: 0, overdue_paise: 0, unallocated_paise: 0, net_outstanding_paise: 0,
    ...Object.fromEntries(BUCKETS.map((b) => [`${b.key}_paise`, 0])),
  });
  const rowFor = (vendor, cid, ccode) => {
    const k = `${vendor || ''}|${cid}`;
    if (!rows.has(k)) rows.set(k, blank(vendor, { id: cid, code: ccode }));
    return rows.get(k);
  };
  for (const inv of book.invoices) {
    if (inv.internal || (companyId && inv.company_id !== companyId)) continue;
    const r = rowFor(inv.vendor, inv.company_id, inv.company);
    r.invoices += 1;
    r.invoiced_paise += inv.total_paise;
    r.received_paise += inv.received_paise;
    r.credit_notes_paise += inv.credit_notes_paise;
    r.tds_paise += inv.tds_paise;
    r.adjustments_paise += inv.adjustments_paise;
    if (inv.outstanding_paise != null && inv.outstanding_paise > 0) {
      r.open_invoices += 1;
      r.outstanding_paise += inv.outstanding_paise;
      if (inv.status === 'overdue') r.overdue_paise += inv.outstanding_paise;
      r[`${inv.bucket}_paise`] += inv.outstanding_paise;
    }
  }
  for (const u of book.unallocated) {
    if (companyId && u.company_id !== companyId) continue;
    rowFor(u.vendor, u.company_id, u.company).unallocated_paise += u.amount_paise;
  }
  for (const r of rows.values()) r.net_outstanding_paise = r.outstanding_paise - r.unallocated_paise;
  const list = [...rows.values()].sort((a, b) => b.outstanding_paise - a.outstanding_paise || String(a.vendor).localeCompare(String(b.vendor)));
  const totals = blank(null, { id: null, code: null });
  for (const r of list) {
    for (const k of Object.keys(totals)) if (k.endsWith('_paise') || k === 'invoices' || k === 'open_invoices') totals[k] += r[k];
  }
  return { rows: list, totals, buckets: BUCKETS.map(({ key, label }) => ({ key, label })) };
}

module.exports = {
  loadBook, loadSettings, receivables, groupChains, BUCKETS, daysBetween, addDays,
};
