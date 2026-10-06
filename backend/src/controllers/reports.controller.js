const db = require('../config/db');
const { logAction, diffFields } = require('../services/auditLog.service');
const {
  loadBook, loadSettings, receivables: receivablesOf, daysBetween,
} = require('../books/book');

// Reports: Invoices, Credit & debit notes, Stock transfers, Receivables and
// Exceptions, worked out at read time from the Tally copy (src/books/book.js).
// Every list filters by company (or all companies, consolidated) and pages.
// Seeing them is reports.view; credit terms and exception days are
// reports.settings (audited).

const PAGE_SIZE = 50;
const PAGE_SIZE_MAX = 10000; // a CSV download asks for everything at once
const INVOICE_STATUSES = ['open', 'overdue', 'settled', 'no_po', 'not_billwise'];

const fail = (status, message) => Object.assign(new Error(message), { status });
const sendError = (res, next, err) => (err.status && err.status < 500 ? res.status(err.status).json({ message: err.message }) : next(err));
const rowsOf = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const pageOf = (q) => {
  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(q.page_size, 10) || PAGE_SIZE));
  return { page, pageSize };
};
const paged = (list, q, extra = {}) => {
  const { page, pageSize } = pageOf(q);
  return {
    rows: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, page_size: pageSize, ...extra,
  };
};
const companyOf = (q) => (q.company_id ? Number(q.company_id) : null);
const matches = (q, ...values) => {
  const s = String(q || '').trim().toLowerCase();
  return !s || values.some((v) => v != null && String(v).toLowerCase().includes(s));
};
const sum = (list, k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);

// ------------------------------------------------------------ invoices

// GET /api/reports/invoices?company_id&vendor&status&q&from&to&sort&page&page_size
// vendor '-' = no marketplace known. Stock transfers are on their own page.
async function invoices(req, res, next) {
  try {
    const q = req.query;
    if (q.status && !INVOICE_STATUSES.includes(q.status)) throw fail(400, 'Unknown status');
    const book = await loadBook(db);
    const companyId = companyOf(q);
    let list = book.invoices.filter((i) => !i.internal
      && (!companyId || i.company_id === companyId)
      && (!q.vendor || (q.vendor === '-' ? !i.vendor : i.vendor === q.vendor))
      && (!q.from || i.date >= q.from) && (!q.to || i.date <= q.to)
      && (!q.status || (q.status === 'no_po' ? !i.pos.length : i.status === q.status))
      && matches(q.q, i.number, i.party, ...i.pos));
    const sorts = {
      oldest: (a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
      outstanding: (a, b) => (b.outstanding_paise || 0) - (a.outstanding_paise || 0),
      overdue: (a, b) => b.overdue_days - a.overdue_days || (b.outstanding_paise || 0) - (a.outstanding_paise || 0),
    };
    list = list.sort(sorts[q.sort] || ((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)));
    const totals = {
      invoices: list.length,
      total_paise: sum(list, 'total_paise'),
      outstanding_paise: list.reduce((a, i) => a + Math.max(0, i.outstanding_paise || 0), 0),
      overdue_paise: list.filter((i) => i.status === 'overdue').reduce((a, i) => a + i.outstanding_paise, 0),
    };
    const vendors = [...new Set(book.invoices.map((i) => i.vendor).filter(Boolean))].sort();
    res.json(paged(list, q, { totals, vendors, companies: book.companies, as_of: book.today }));
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ notes

// GET /api/reports/notes?company_id&type=cn|dn&q&page&page_size -- credit and
// debit notes, with the invoices they settle, the PO and the RTV row.
async function notes(req, res, next) {
  try {
    const q = req.query;
    const book = await loadBook(db);
    const companyId = companyOf(q);
    const base = q.type === 'dn' ? 'Debit Note' : q.type === 'cn' ? 'Credit Note' : null;
    const invoiceByBill = new Map();
    for (const i of book.invoices) for (const b of i.bills) invoiceByBill.set(`${i.company_id}|${b}`, i);
    const againstOf = new Map();
    for (const b of book.bills) {
      if (b.bill_type !== 'Agst Ref' || !b.name) continue;
      const k = Number(b.voucher_id);
      if (!againstOf.has(k)) againstOf.set(k, new Set());
      againstOf.get(k).add(String(b.name).trim());
    }
    const [rtvLinks, fills] = await Promise.all([
      rowsOf(`SELECT d.company_id, d.voucher_guid, d.target_id, t.rtv_no, t.po_id FROM doc_links d
                LEFT JOIN roms_rtv t ON t.id = CAST(d.target_id AS INTEGER)
               WHERE d.target_kind = 'rtv' AND d.status IN ('auto','confirmed')`),
      rowsOf(`SELECT r.target_id, i.state, i.reason,
                     (SELECT e.at FROM autofill_events e WHERE e.target_kind = 'rtv' AND e.target_id = r.target_id AND e.result = 'applied' ORDER BY e.id DESC LIMIT 1) AS written_at
                FROM match_results r LEFT JOIN autofill_items i ON i.target_kind = r.target_kind AND i.target_id = r.target_id
               WHERE r.target_kind = 'rtv' AND r.outcome = 'linked'`),
    ]);
    const rtvOf = new Map(rtvLinks.map((l) => [`${Number(l.company_id)}|${l.voucher_guid}`, l]));
    const fillOf = new Map(fills.map((f) => [f.target_id, f]));
    const code = new Map(book.companies.map((c) => [c.id, c.code]));
    let list = book.vouchers
      .filter((v) => (v.base_type === 'Credit Note' || v.base_type === 'Debit Note') && (!base || v.base_type === base)
        && (!companyId || Number(v.company_id) === companyId))
      .map((v) => {
        const cid = Number(v.company_id);
        const against = [...(againstOf.get(Number(v.id)) || [])];
        const invs = against.map((name) => invoiceByBill.get(`${cid}|${name}`)).filter(Boolean);
        const rtv = rtvOf.get(`${cid}|${v.guid}`) || null;
        const fill = rtv ? fillOf.get(String(rtv.target_id)) : null;
        return {
          company_id: cid,
          company: code.get(cid),
          guid: v.guid,
          type: v.base_type === 'Credit Note' ? 'cn' : 'dn',
          voucher_type: v.voucher_type,
          number: v.number,
          date: v.date,
          party: v.party,
          amount_paise: Math.abs(Number(v.total_paise) || 0),
          against,
          invoices: invs.map((i) => i.number),
          pos: [...new Set(invs.flatMap((i) => i.pos))],
          vendor: invs.find((i) => i.vendor)?.vendor || null,
          rtv: rtv ? { id: Number(rtv.target_id), rtv_no: rtv.rtv_no, po_id: rtv.po_id } : null,
          autofill: fill ? { state: fill.state || null, reason: fill.reason || null, written_at: fill.written_at || null } : null,
        };
      })
      .filter((n) => matches(q.q, n.number, n.party, ...n.against, ...n.pos, n.rtv?.rtv_no));
    list = list.sort((a, b) => b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number)));
    res.json(paged(list, q, { totals: { notes: list.length, amount_paise: sum(list, 'amount_paise') }, companies: book.companies }));
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ transfers

// GET /api/reports/transfers?company_id&q&page&page_size -- sales to our own
// registrations (a ledger mapped, or found by GSTIN, as Our own registration).
async function transfers(req, res, next) {
  try {
    const q = req.query;
    const book = await loadBook(db);
    const companyId = companyOf(q);
    const list = book.invoices
      .filter((i) => i.internal && (!companyId || i.company_id === companyId) && matches(q.q, i.number, i.party))
      .sort((a, b) => b.date.localeCompare(a.date));
    const guids = list.map((i) => i.guid);
    const qty = new Map();
    if (guids.length) {
      const rows = await rowsOf(`SELECT v.company_id, v.guid, SUM(ABS(l.qty)) AS qty, COUNT(*) AS lines FROM tally_vch_inventory_lines l
                                   JOIN tally_vouchers v ON v.id = l.voucher_id
                                  WHERE v.guid IN (${guids.map(() => '?').join(',')}) GROUP BY v.company_id, v.guid`, guids);
      for (const r of rows) qty.set(`${Number(r.company_id)}|${r.guid}`, { qty: Number(r.qty) || 0, lines: Number(r.lines) });
    }
    const out = list.map((i) => ({
      company_id: i.company_id, company: i.company, guid: i.guid, number: i.number, date: i.date, party: i.party,
      total_paise: i.total_paise, ...(qty.get(i.key) || { qty: 0, lines: 0 }),
    }));
    res.json(paged(out, q, { totals: { transfers: out.length, total_paise: sum(out, 'total_paise') }, companies: book.companies }));
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ receivables

// GET /api/reports/receivables?company_id
async function receivables(req, res, next) {
  try {
    const book = await loadBook(db);
    res.json({
      ...receivablesOf(book, { companyId: companyOf(req.query) }), as_of: book.today, companies: book.companies, settings: book.settings,
    });
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ exceptions

const EXCEPTION_LIMIT = 200;

// GET /api/reports/exceptions?company_id -- each kind of thing that needs a
// person, with where it is fixed.
async function exceptions(req, res, next) {
  try {
    const companyId = companyOf(req.query);
    const book = await loadBook(db);
    const days = book.settings.exception_days;
    const [results, fills, modes] = await Promise.all([
      rowsOf(`SELECT r.target_kind, r.target_id, r.po_id, r.outcome, r.reason, r.vendor, r.company_id, r.detail, r.outcome_since,
                     p.vendor_po_id, p.bill_no, p.grn_date, p.grn_status, p.discrepancy_qty, t.rtv_no, t.cn_number
                FROM match_results r
                LEFT JOIN roms_pos p ON p.po_id = r.po_id
                LEFT JOIN roms_rtv t ON r.target_kind = 'rtv' AND t.id = CAST(r.target_id AS INTEGER)
               WHERE r.outcome IN ('review','waiting')`),
      rowsOf(`SELECT i.target_kind, i.target_id, i.po_id, i.state, i.reason, i.expected, i.value, i.dry, t.rtv_no
                FROM autofill_items i LEFT JOIN roms_rtv t ON i.target_kind = 'rtv' AND t.id = CAST(i.target_id AS INTEGER)
               WHERE i.state IN ('refused','differs')`),
      rowsOf("SELECT vendor FROM match_vendors WHERE mode <> 'match'"),
    ]);
    // A vendor set to stock transfer or "don't match" never has POs linked.
    const unmatched = new Set(modes.map((m) => m.vendor));
    const inCompany = (r) => !companyId || r.company_id == null || Number(r.company_id) === companyId;
    const params = (r) => { try { return JSON.parse(r.detail || '{}').params || {}; } catch { return {}; } };
    const po = (r) => ({
      kind: r.target_kind, id: r.target_id, po_id: r.po_id, vendor: r.vendor, vendor_po_id: r.vendor_po_id, bill_no: r.bill_no, rtv_no: r.rtv_no, reason: r.reason, params: params(r), since: r.outcome_since,
    });
    const rs = results.filter(inCompany);
    const categories = [
      {
        code: 'bill_not_in_tally',
        rows: rs.filter((r) => r.reason === 'bill_not_in_tally' || r.reason === 'cn_not_in_tally').map(po),
      },
      {
        code: 'invoice_no_po',
        rows: book.invoices
          .filter((i) => !i.internal && !i.pos.length && !unmatched.has(i.vendor) && i.age_days > days && (!companyId || i.company_id === companyId))
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((i) => ({
            company: i.company, number: i.number, date: i.date, party: i.party, vendor: i.vendor, total_paise: i.total_paise, age_days: i.age_days,
          })),
      },
      {
        code: 'conflict',
        rows: [
          ...rs.filter((r) => r.reason === 'bill_differs' || r.reason === 'cn_differs').map(po),
          ...fills.filter((f) => f.state === 'differs').map((f) => ({
            kind: f.target_kind, id: f.target_id, po_id: f.po_id, rtv_no: f.rtv_no, reason: 'autofill_differs', params: { typed: f.expected, number: f.value },
          })),
        ],
      },
      {
        code: 'ambiguous',
        rows: rs.filter((r) => ['ambiguous', 'several_invoices', 'cn_ambiguous', 'several_cns'].includes(r.reason)).map(po),
      },
      {
        code: 'rtv_no_cn',
        rows: rs
          .filter((r) => r.target_kind === 'rtv' && r.reason === 'no_cn_yet')
          .map((r) => ({ ...po(r), age_days: daysBetween(r.grn_date || String(r.outcome_since).slice(0, 10), book.today) }))
          .filter((r) => r.age_days > days)
          .sort((a, b) => b.age_days - a.age_days),
      },
      {
        code: 'autofill_refused',
        rows: fills.filter((f) => f.state === 'refused').map((f) => ({
          kind: f.target_kind, id: f.target_id, po_id: f.po_id, rtv_no: f.rtv_no, value: f.value, reason: f.reason, dry: Boolean(Number(f.dry)),
        })),
      },
    ].map((c) => ({ code: c.code, count: c.rows.length, rows: c.rows.slice(0, EXCEPTION_LIMIT) }));
    res.json({
      categories, exception_days: days, as_of: book.today, companies: book.companies,
    });
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ settings

async function settingsData() {
  const [settings, vendors] = await Promise.all([
    loadSettings(db),
    rowsOf(`SELECT v.vendor, t.credit_days, t.updated_at, u.name AS updated_by_name FROM
              (SELECT name AS vendor FROM roms_vendors UNION SELECT vendor FROM vendor_terms) v
              LEFT JOIN vendor_terms t ON t.vendor = v.vendor LEFT JOIN users u ON u.id = t.updated_by
             ORDER BY v.vendor`),
  ]);
  const { terms, ...rest } = settings;
  return {
    settings: rest,
    terms: vendors.map((v) => ({
      vendor: v.vendor, credit_days: v.credit_days == null ? null : Number(v.credit_days), updated_at: v.updated_at || null, updated_by_name: v.updated_by_name || null,
    })),
  };
}

// GET /api/reports/settings
async function getSettings(req, res, next) {
  try { res.json(await settingsData()); } catch (err) { next(err); }
}

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// PUT /api/reports/settings { default_credit_days?, exception_days? }
async function updateSettings(req, res, next) {
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).filter((k) => !['default_credit_days', 'exception_days'].includes(k));
    if (unknown.length) throw fail(400, `Unknown setting: ${unknown.join(', ')}`);
    const current = await loadSettings(db);
    const merged = { default_credit_days: current.default_credit_days, exception_days: current.exception_days, ...body };
    if (!intIn(merged.default_credit_days, 0, 365)) throw fail(400, 'Credit days must be 0-365');
    if (!intIn(merged.exception_days, 1, 180)) throw fail(400, 'Exception days must be 1-180');
    const changes = diffFields(current, merged, ['default_credit_days', 'exception_days']);
    if (changes.length) {
      await db.execute({
        sql: "UPDATE report_settings SET default_credit_days = ?, exception_days = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1",
        args: [merged.default_credit_days, merged.exception_days, req.user.id],
      });
      await logAction({
        userId: req.user.id, actionType: 'REPORT_SETTINGS_UPDATE', description: 'Report settings changed', entityType: 'report_settings', entityId: 1, changes,
      });
    }
    res.json(await settingsData());
  } catch (err) { sendError(res, next, err); }
}

// PUT /api/reports/terms/:vendor { credit_days: n | null } -- null goes back to the default.
async function updateTerms(req, res, next) {
  try {
    const { vendor } = req.params;
    const days = (req.body || {}).credit_days;
    if (days !== null && !intIn(days, 0, 365)) throw fail(400, 'Credit days must be 0-365, or empty for the default');
    const [known] = await rowsOf('SELECT 1 FROM roms_vendors WHERE name = ? UNION SELECT 1 FROM vendor_terms WHERE vendor = ?', [vendor, vendor]);
    if (!known) throw fail(404, `No vendor ${vendor}`);
    const [old] = await rowsOf('SELECT credit_days FROM vendor_terms WHERE vendor = ?', [vendor]);
    const before = old ? Number(old.credit_days) : null;
    if (before !== days) {
      if (days === null) await db.execute({ sql: 'DELETE FROM vendor_terms WHERE vendor = ?', args: [vendor] });
      else {
        await db.execute({
          sql: `INSERT INTO vendor_terms (vendor, credit_days, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
                ON CONFLICT(vendor) DO UPDATE SET credit_days = excluded.credit_days, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          args: [vendor, days, req.user.id],
        });
      }
      await logAction({
        userId: req.user.id,
        actionType: 'VENDOR_TERMS_UPDATE',
        description: `${vendor}: credit days ${before == null ? 'default' : before} → ${days == null ? 'default' : days}`,
        entityType: 'vendor_terms',
        entityRef: vendor,
        changes: [{ field: 'credit_days', old: before, new: days }],
      });
    }
    res.json(await settingsData());
  } catch (err) { sendError(res, next, err); }
}

module.exports = {
  invoices, notes, transfers, receivables, exceptions, getSettings, updateSettings, updateTerms,
};
