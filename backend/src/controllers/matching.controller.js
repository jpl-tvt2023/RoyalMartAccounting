const db = require('../config/db');
const { logAction, diffFields } = require('../services/auditLog.service');
const {
  DEFAULTS, loadSettings, loadRow, shape, toColumns, validate,
} = require('../services/matchSettings');
const { refreshState } = require('../services/romsRefs');
const { runMatching, rematch, previewMatching } = require('../matching/run');

// Matching -> Match review, Matching rules and Party ledgers. Who may do what
// is the matching.* permissions (routes/matching.routes.js). Every change is
// audited and re-matches at once, so the page shows its effect.

const KINDS = ['po', 'rtv'];
const OUTCOMES = ['linked', 'review', 'waiting', 'not_matched'];
const MODES = ['match', 'transfer', 'skip'];
const PARTY_KINDS = ['vendor', 'internal', 'other'];
const PAGE_SIZE = 50;
const PAGE_SIZE_MAX = 200;

const fail = (status, message) => Object.assign(new Error(message), { status });
const sendError = (res, next, err) => (err.status && err.status < 500
  ? res.status(err.status).json({ message: err.message })
  : next(err));
const parse = (v, fallback) => {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const rowsOf = async (sql, args = []) => (await db.execute({ sql, args })).rows;

async function inTx(work) {
  const tx = await db.transaction('write');
  try {
    const out = await work(tx);
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// ------------------------------------------------------------ summary

async function summaryData() {
  const [counts, reasons, methods, fills, notes, runs, vendors, companies, roms] = await Promise.all([
    rowsOf('SELECT target_kind, outcome, COUNT(*) AS n FROM match_results GROUP BY target_kind, outcome'),
    rowsOf("SELECT target_kind, reason, COUNT(*) AS n FROM match_results WHERE reason IS NOT NULL GROUP BY target_kind, reason"),
    rowsOf("SELECT target_kind, method, COUNT(*) AS n FROM match_results WHERE outcome = 'linked' GROUP BY target_kind, method"),
    rowsOf(`SELECT target_kind, json_extract(fill, '$.kind') AS kind, COUNT(*) AS n FROM match_results
             WHERE outcome = 'linked' AND fill IS NOT NULL GROUP BY target_kind, kind`),
    rowsOf(`SELECT j.value AS code, COUNT(*) AS n FROM match_results r, json_each(r.detail, '$.notes') j
             WHERE r.target_kind = 'po' GROUP BY j.value`),
    rowsOf(`SELECT r.id, r.trigger, r.status, r.roms_ok, r.roms_error, r.counts, r.error, r.ms, r.started_at, r.finished_at, u.name AS by_name
              FROM match_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 1`),
    rowsOf(`SELECT DISTINCT vendor FROM match_results WHERE vendor IS NOT NULL ORDER BY vendor`),
    rowsOf('SELECT id, code, name FROM tally_companies WHERE sync_enabled = 1 ORDER BY code, name'),
    refreshState(db),
  ]);
  const byKind = (rows, key) => {
    const out = { po: {}, rtv: {} };
    for (const r of rows) if (out[r.target_kind]) out[r.target_kind][r[key]] = Number(r.n);
    return out;
  };
  const outcomeCounts = { po: {}, rtv: {} };
  for (const k of KINDS) for (const o of OUTCOMES) outcomeCounts[k][o] = 0;
  for (const r of counts) outcomeCounts[r.target_kind][r.outcome] = Number(r.n);
  const last = runs[0];
  return {
    counts: outcomeCounts,
    reasons: byKind(reasons, 'reason'),
    methods: byKind(methods, 'method'),
    fills: byKind(fills, 'kind'),
    notes: Object.fromEntries(notes.map((r) => [r.code, Number(r.n)])),
    last_run: last ? {
      id: Number(last.id), trigger: last.trigger, status: last.status, by: last.by_name || null,
      started_at: last.started_at, finished_at: last.finished_at, ms: last.ms == null ? null : Number(last.ms),
      error: last.error, roms_ok: last.roms_ok == null ? null : Boolean(last.roms_ok), roms_error: last.roms_error,
    } : null,
    roms,
    vendors: vendors.map((v) => v.vendor),
    companies: companies.map((c) => ({ id: Number(c.id), code: c.code, name: c.name })),
  };
}

// GET /api/matching/summary
async function summary(req, res, next) {
  try {
    res.json(await summaryData());
  } catch (err) { next(err); }
}

// ------------------------------------------------------------ results

const RESULT_SELECT = `
  SELECT r.target_kind, r.target_id, r.po_id, r.outcome, r.reason, r.method, r.vendor, r.company_id, c.code AS company,
         r.voucher_guid, r.voucher_number, r.voucher_date, r.detail, r.fill, r.outcome_since, r.updated_at,
         p.vendor_po_id, p.bill_no, p.bill_date, p.po_date, p.status AS po_status, p.party_name, p.city,
         t.rtv_no, t.cn_number, t.cn_date, t.status AS rtv_status,
         ai.state AS af_state, ai.reason AS af_reason, ai.dry AS af_dry, ai.kind AS af_kind,
         (SELECT e.at FROM autofill_events e WHERE e.target_kind = r.target_kind AND e.target_id = r.target_id
             AND e.result = 'applied' ORDER BY e.id DESC LIMIT 1) AS af_written_at
    FROM match_results r
    LEFT JOIN tally_companies c ON c.id = r.company_id
    LEFT JOIN roms_pos p ON p.po_id = r.po_id
    LEFT JOIN roms_rtv t ON r.target_kind = 'rtv' AND t.id = CAST(r.target_id AS INTEGER)
    LEFT JOIN autofill_items ai ON ai.target_kind = r.target_kind AND ai.target_id = r.target_id`;

function shapeResult(r, { full = false } = {}) {
  const detail = parse(r.detail, {});
  const out = {
    kind: r.target_kind,
    id: r.target_id,
    po_id: r.po_id,
    outcome: r.outcome,
    reason: r.reason,
    method: r.method,
    vendor: r.vendor,
    company_id: r.company_id == null ? null : Number(r.company_id),
    company: r.company || null,
    voucher_guid: r.voucher_guid,
    voucher_number: r.voucher_number,
    voucher_date: r.voucher_date,
    fill: parse(r.fill, null),
    // Where auto-fill is with this row: the open item's state, or when RAMS
    // last wrote it into ROMS.
    autofill: r.af_state || r.af_written_at ? {
      state: r.af_state || null,
      write_kind: r.af_kind || null,
      reason: r.af_reason || null,
      dry: Boolean(Number(r.af_dry || 0)),
      written_at: r.af_written_at || null,
    } : null,
    params: detail.params || {},
    notes: detail.notes || [],
    person: detail.person || null,
    candidate_count: (detail.candidates || []).length,
    outcome_since: r.outcome_since,
    po: {
      vendor_po_id: r.vendor_po_id, bill_no: r.bill_no, bill_date: r.bill_date, po_date: r.po_date,
      status: r.po_status, party_name: r.party_name, city: r.city,
    },
    rtv: r.target_kind === 'rtv' ? { rtv_no: r.rtv_no, cn_number: r.cn_number, cn_date: r.cn_date, status: r.rtv_status } : null,
  };
  if (full) {
    out.how = detail.how || [];
    out.checks = detail.checks || [];
    out.candidates = detail.candidates || [];
  }
  return out;
}

// GET /api/matching/results?kind=po|rtv&outcome=&reason=&vendor=&company_id=&q=&sort=oldest|newest&page=&page_size=
async function results(req, res, next) {
  try {
    const q = req.query;
    const kind = KINDS.includes(q.kind) ? q.kind : 'po';
    const where = ['r.target_kind = ?'];
    const args = [kind];
    if (q.outcome) {
      if (!OUTCOMES.includes(q.outcome)) return res.status(400).json({ message: 'Unknown status' });
      where.push('r.outcome = ?'); args.push(q.outcome);
    }
    if (q.reason) { where.push('r.reason = ?'); args.push(String(q.reason)); }
    if (q.vendor) { where.push('r.vendor = ?'); args.push(String(q.vendor)); }
    if (q.company_id) { where.push('r.company_id = ?'); args.push(Number(q.company_id)); }
    if (q.q && String(q.q).trim()) {
      const like = `%${String(q.q).trim()}%`;
      where.push(`(r.po_id LIKE ? OR p.vendor_po_id LIKE ? OR p.bill_no LIKE ? OR r.voucher_number LIKE ? OR t.rtv_no LIKE ? OR t.cn_number LIKE ?)`);
      args.push(like, like, like, like, like, like);
    }
    const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(q.page_size, 10) || PAGE_SIZE));
    const order = q.sort === 'newest' ? 'DESC' : 'ASC';
    const base = `${RESULT_SELECT} WHERE ${where.join(' AND ')}`;
    const [rows, [{ total }]] = await Promise.all([
      rowsOf(`${base} ORDER BY p.po_date ${order}, r.po_id ${order}, CAST(r.target_id AS INTEGER) ${order}, r.target_id ${order} LIMIT ? OFFSET ?`,
        [...args, pageSize, (page - 1) * pageSize]),
      rowsOf(`SELECT COUNT(*) AS total FROM (${base})`, args),
    ]);
    res.json({ rows: rows.map((r) => shapeResult(r)), total: Number(total), page, page_size: pageSize });
  } catch (err) { next(err); }
}

async function loadResult(kind, id) {
  if (!KINDS.includes(kind)) throw fail(404, 'Not found');
  const [row] = await rowsOf(`${RESULT_SELECT} WHERE r.target_kind = ? AND r.target_id = ?`, [kind, String(id)]);
  if (!row) throw fail(404, kind === 'po' ? `PO ${id} isn't in the matching results` : `RTV row ${id} isn't in the matching results`);
  return row;
}

// GET /api/matching/results/:kind/:id -- with the explanation, every
// candidate, the PO's lines and its RTV rows.
async function result(req, res, next) {
  try {
    const row = await loadResult(req.params.kind, req.params.id);
    const out = shapeResult(row, { full: true });
    const [lines, rtvRows, links] = await Promise.all([
      rowsOf('SELECT line_no, item_code, qty, sku_code FROM roms_po_lines WHERE po_id = ? ORDER BY line_no', [row.po_id]),
      rowsOf(`SELECT t.id, t.rtv_no, t.cn_number, t.status, r.outcome, r.reason, r.voucher_number FROM roms_rtv t
                LEFT JOIN match_results r ON r.target_kind = 'rtv' AND r.target_id = CAST(t.id AS TEXT)
               WHERE t.po_id = ? ORDER BY t.id`, [row.po_id]),
      rowsOf(`SELECT d.company_id, d.voucher_guid, d.status, d.method, d.decided_at, u.name AS decided_by FROM doc_links d
                LEFT JOIN users u ON u.id = d.decided_by WHERE d.target_kind = ? AND d.target_id = ?`, [row.target_kind, row.target_id]),
    ]);
    out.lines = lines;
    out.rtv_rows = rtvRows.map((r) => ({ ...r, id: Number(r.id) }));
    out.decisions = links.filter((l) => l.status !== 'auto').map((l) => ({ ...l, company_id: Number(l.company_id) }));
    res.json(out);
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ run

// POST /api/matching/run -- "Match now": read ROMS again and re-match.
async function run(req, res, next) {
  try {
    const out = await runMatching(db, { trigger: 'manual', userId: req.user.id });
    res.json({ ...out, summary: await summaryData() });
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ decisions

// The voucher a decision names: a live one of the right kind, in a company
// whose sync is on.
async function voucherFor(kind, companyId, guid) {
  const base = kind === 'po' ? 'Sales' : 'Credit Note';
  const [v] = await rowsOf(
    `SELECT v.company_id, v.guid, v.number, v.date, c.code FROM tally_vouchers v JOIN tally_companies c ON c.id = v.company_id
      WHERE v.company_id = ? AND v.guid = ? AND v.deleted_at IS NULL AND v.base_type = ? AND c.sync_enabled = 1`,
    [Number(companyId), String(guid || ''), base],
  );
  if (!v) throw fail(400, kind === 'po' ? 'That Tally sales invoice was not found' : 'That Tally credit note was not found');
  return v;
}

const label = (kind, row) => (kind === 'po' ? `PO ${row.po_id}` : `RTV ${row.rtv_no || row.target_id} (PO ${row.po_id})`);
const noun = (kind) => (kind === 'po' ? 'invoice' : 'credit note');

async function decide(req, res, next, action) {
  try {
    const { kind, id } = req.params;
    const row = await loadResult(kind, id);
    const role = kind === 'po' ? 'invoice' : 'credit_note';
    let v = null;
    if (action !== 'undo') {
      const body = req.body || {};
      const companyId = body.company_id ?? row.company_id;
      const guid = body.voucher_guid ?? row.voucher_guid;
      if (companyId == null || !guid) throw fail(400, `Say which ${noun(kind)}`);
      v = await voucherFor(kind, companyId, guid);
    }
    const what = v ? `${noun(kind)} ${v.number || '(no number)'} (${v.code}, ${v.date})` : '';
    await inTx(async (tx) => {
      if (action === 'undo') {
        await tx.execute({ sql: "DELETE FROM doc_links WHERE target_kind = ? AND target_id = ? AND status IN ('confirmed','rejected')", args: [kind, String(id)] });
      } else {
        if (action === 'pick' || action === 'confirm') {
          // One settled answer per row: a new pick replaces an earlier one.
          await tx.execute({
            sql: "DELETE FROM doc_links WHERE target_kind = ? AND target_id = ? AND status = 'confirmed' AND NOT (company_id = ? AND voucher_guid = ?)",
            args: [kind, String(id), Number(v.company_id), v.guid],
          });
        }
        await tx.execute({
          sql: `INSERT INTO doc_links (target_kind, target_id, role, company_id, voucher_guid, method, status, decided_by, decided_at)
                VALUES (?, ?, ?, ?, ?, 'person', ?, ?, datetime('now'))
                ON CONFLICT(target_kind, target_id, company_id, voucher_guid) DO UPDATE SET
                  status = excluded.status, method = 'person', decided_by = excluded.decided_by,
                  decided_at = excluded.decided_at, updated_at = datetime('now')`,
          args: [kind, String(id), role, Number(v.company_id), v.guid, action === 'reject' ? 'rejected' : 'confirmed', req.user.id],
        });
      }
      const description = {
        confirm: `Confirmed ${what} for ${label(kind, row)}`,
        pick: `Picked ${what} for ${label(kind, row)}`,
        reject: `Rejected ${what} for ${label(kind, row)}`,
        undo: `Undid the decisions on ${label(kind, row)} — back to automatic matching`,
      }[action];
      await logAction({
        client: tx, userId: req.user.id, actionType: `MATCH_${action.toUpperCase()}`, description,
        entityType: kind, entityRef: String(id),
      });
    });
    await rematch(db);
    const fresh = await loadResult(kind, id);
    res.json(shapeResult(fresh, { full: true }));
  } catch (err) { sendError(res, next, err); }
}

const confirm = (req, res, next) => decide(req, res, next, 'confirm');
const pick = (req, res, next) => decide(req, res, next, 'pick');
const reject = (req, res, next) => decide(req, res, next, 'reject');
const undo = (req, res, next) => decide(req, res, next, 'undo');

// GET /api/matching/vouchers?kind=po|rtv&q= -- Tally vouchers to pick from by
// number or party, when the right one isn't among the candidates.
async function searchVouchers(req, res, next) {
  try {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'po';
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ rows: [] });
    const rows = await rowsOf(
      `SELECT v.company_id, c.code AS company, v.guid, v.number, v.date, v.party, v.voucher_type, v.total_paise
         FROM tally_vouchers v JOIN tally_companies c ON c.id = v.company_id
        WHERE v.deleted_at IS NULL AND c.sync_enabled = 1 AND v.base_type = ? AND v.is_cancelled = 0
          AND (v.number LIKE ? OR v.party LIKE ?)
        ORDER BY v.date DESC LIMIT 20`,
      [kind === 'po' ? 'Sales' : 'Credit Note', `%${q}%`, `%${q}%`],
    );
    res.json({ rows: rows.map((r) => ({ ...r, company_id: Number(r.company_id), total_paise: r.total_paise == null ? null : Number(r.total_paise) })) });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------ rules

// GET /api/matching/settings
async function getSettings(req, res, next) {
  try {
    res.json({ settings: await loadSettings(db), recommended: DEFAULTS });
  } catch (err) { next(err); }
}

async function saveSettings(req, res, next, body, { description }) {
  const current = await loadSettings(db);
  const { settings, error } = validate(body, current);
  if (error) throw fail(400, error);
  const before = toColumns(current);
  const after = toColumns(settings);
  const changes = diffFields(before, after, Object.keys(after));
  if (changes.length) {
    await inTx(async (tx) => {
      await tx.execute({
        sql: `UPDATE match_settings SET ${Object.keys(after).map((k) => `${k} = ?`).join(', ')},
                updated_at = datetime('now'), updated_by = ? WHERE id = 1`,
        args: [...Object.values(after), req.user.id],
      });
      await logAction({
        client: tx, userId: req.user.id, actionType: 'MATCH_SETTINGS_UPDATE', description,
        entityType: 'match_settings', entityId: 1, changes,
      });
    });
  }
  const counts = changes.length ? await rematch(db) : null;
  return { settings: shape(await loadRow(db)), recommended: DEFAULTS, changed: changes.length, counts };
}

// PUT /api/matching/settings -- any subset of the rules; re-matches.
async function updateSettings(req, res, next) {
  try {
    res.json(await saveSettings(req, res, next, req.body || {}, { description: 'Matching rules changed' }));
  } catch (err) { sendError(res, next, err); }
}

// POST /api/matching/settings/reset -- back to the recommended rules.
async function resetSettings(req, res, next) {
  try {
    res.json(await saveSettings(req, res, next, { ...DEFAULTS }, { description: 'Matching rules reset to the recommended ones' }));
  } catch (err) { sendError(res, next, err); }
}

// POST /api/matching/preview { ...draft rules } -- what saving would change.
async function preview(req, res, next) {
  try {
    const { settings, error } = validate(req.body || {}, await loadSettings(db));
    if (error) throw fail(400, error);
    res.json(await previewMatching(db, settings));
  } catch (err) { sendError(res, next, err); }
}

// GET /api/matching/vendors -- every ROMS vendor with its setting and POs.
async function vendors(req, res, next) {
  try {
    const rows = await rowsOf(
      `SELECT v.vendor, COALESCE(m.mode, 'match') AS mode, m.updated_at, u.name AS updated_by_name,
              (SELECT COUNT(*) FROM roms_pos p WHERE p.vendor = v.vendor AND p.status <> 'Deleted') AS pos,
              (SELECT COUNT(*) FROM match_results r WHERE r.target_kind = 'po' AND r.vendor = v.vendor AND r.outcome = 'linked') AS linked
         FROM (SELECT name AS vendor FROM roms_vendors UNION SELECT vendor FROM match_vendors
               UNION SELECT DISTINCT vendor FROM roms_pos WHERE vendor IS NOT NULL) v
         LEFT JOIN match_vendors m ON m.vendor = v.vendor
         LEFT JOIN users u ON u.id = m.updated_by
        ORDER BY v.vendor`,
    );
    res.json({ rows: rows.map((r) => ({ ...r, pos: Number(r.pos), linked: Number(r.linked) })) });
  } catch (err) { next(err); }
}

// PUT /api/matching/vendors/:vendor { mode } -- re-matches.
async function updateVendor(req, res, next) {
  try {
    const vendor = String(req.params.vendor || '').trim();
    const mode = req.body?.mode;
    if (!vendor || vendor.length > 100) throw fail(400, 'Say which vendor');
    if (!MODES.includes(mode)) throw fail(400, 'A vendor is matched, a stock transfer, or not matched');
    const [old] = await rowsOf('SELECT mode FROM match_vendors WHERE vendor = ?', [vendor]);
    const before = old ? old.mode : 'match';
    if (before !== mode) {
      await inTx(async (tx) => {
        await tx.execute({
          sql: `INSERT INTO match_vendors (vendor, mode, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
                ON CONFLICT(vendor) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          args: [vendor, mode, req.user.id],
        });
        await logAction({
          client: tx, userId: req.user.id, actionType: 'MATCH_VENDOR_UPDATE', description: `${vendor}: ${before} → ${mode}`,
          entityType: 'match_vendor', entityRef: vendor, changes: [{ field: 'mode', old: before, new: mode }],
        });
      });
      await rematch(db);
    }
    res.json({ vendor, mode });
  } catch (err) { sendError(res, next, err); }
}

// GET /api/matching/voucher-types -- the Tally types that can be invoices or
// credit notes, and whether each is left out.
async function voucherTypes(req, res, next) {
  try {
    const [rows, settings] = await Promise.all([
      rowsOf(`SELECT v.voucher_type, v.base_type, COUNT(*) AS n FROM tally_vouchers v JOIN tally_companies c ON c.id = v.company_id
               WHERE v.deleted_at IS NULL AND c.sync_enabled = 1 AND v.base_type IN ('Sales','Credit Note')
               GROUP BY v.voucher_type, v.base_type ORDER BY v.base_type DESC, v.voucher_type`),
      loadSettings(db),
    ]);
    const left = new Set(settings.excluded_voucher_types.map((t) => t.toUpperCase()));
    res.json({ rows: rows.map((r) => ({ ...r, n: Number(r.n), excluded: left.has(String(r.voucher_type).toUpperCase()) })) });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------ party ledgers

// GET /api/matching/party-ledgers?company_id=&status=not_set|suggested|set&q=&page=
// The ledgers that are the party on a sales invoice or credit note.
async function partyLedgers(req, res, next) {
  try {
    const q = req.query;
    const where = ['l.deleted_at IS NULL', 'c.sync_enabled = 1', 'vc.n > 0'];
    const args = [];
    if (q.company_id) { where.push('l.company_id = ?'); args.push(Number(q.company_id)); }
    if (q.status === 'not_set') where.push('pl.kind IS NULL');
    if (q.status === 'suggested') where.push("pl.kind IS NULL AND pl.suggested_vendor IS NOT NULL");
    if (q.status === 'set') where.push('pl.kind IS NOT NULL');
    if (q.q && String(q.q).trim()) { where.push('l.name LIKE ?'); args.push(`%${String(q.q).trim()}%`); }
    const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(q.page_size, 10) || PAGE_SIZE));
    const base = `
      FROM tally_ledgers l
      JOIN tally_companies c ON c.id = l.company_id
      JOIN (SELECT company_id, party, COUNT(*) AS n FROM tally_vouchers
             WHERE deleted_at IS NULL AND base_type IN ('Sales','Credit Note') GROUP BY company_id, party) vc
        ON vc.company_id = l.company_id AND vc.party = l.name
      LEFT JOIN party_ledgers pl ON pl.company_id = l.company_id AND pl.ledger_guid = l.guid
      LEFT JOIN users u ON u.id = pl.updated_by
     WHERE ${where.join(' AND ')}`;
    const [rows, [{ total }], [{ suggestions }]] = await Promise.all([
      rowsOf(`SELECT l.company_id, c.code AS company, l.guid, l.name, l.gstin, vc.n AS vouchers,
                     pl.kind, pl.vendor, pl.source, pl.suggested_vendor, COALESCE(pl.suggested_votes, 0) AS suggested_votes,
                     pl.updated_at, u.name AS updated_by_name
              ${base} ORDER BY (pl.kind IS NULL) DESC, COALESCE(pl.suggested_votes, 0) DESC, vc.n DESC, l.name LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]),
      rowsOf(`SELECT COUNT(*) AS total ${base}`, args),
      rowsOf(`SELECT COUNT(*) AS suggestions FROM party_ledgers pl JOIN tally_companies c ON c.id = pl.company_id
               WHERE c.sync_enabled = 1 AND pl.kind IS NULL AND pl.suggested_vendor IS NOT NULL`),
    ]);
    res.json({
      rows: rows.map((r) => ({ ...r, company_id: Number(r.company_id), vouchers: Number(r.vouchers), suggested_votes: Number(r.suggested_votes) })),
      total: Number(total), page, page_size: pageSize, suggestions_waiting: Number(suggestions),
    });
  } catch (err) { next(err); }
}

async function knownVendor(vendor) {
  const [row] = await rowsOf('SELECT 1 AS ok FROM roms_vendors WHERE name = ? UNION SELECT 1 FROM match_vendors WHERE vendor = ? UNION SELECT 1 FROM roms_pos WHERE vendor = ? LIMIT 1', [vendor, vendor, vendor]);
  return Boolean(row);
}

// PUT /api/matching/party-ledgers/:companyId/:guid { kind: vendor|internal|other|null, vendor? }
async function updatePartyLedger(req, res, next) {
  try {
    const companyId = Number(req.params.companyId);
    const guid = String(req.params.guid || '');
    const [ledger] = await rowsOf('SELECT name FROM tally_ledgers WHERE company_id = ? AND guid = ? AND deleted_at IS NULL', [companyId, guid]);
    if (!ledger) throw fail(404, 'Ledger not found');
    const kind = req.body?.kind ?? null;
    const vendor = kind === 'vendor' ? String(req.body?.vendor || '').trim() : null;
    if (kind !== null && !PARTY_KINDS.includes(kind)) throw fail(400, 'A ledger is a marketplace, our own registration, or not a marketplace');
    if (kind === 'vendor' && !(await knownVendor(vendor))) throw fail(400, 'Choose one of the ROMS vendors');
    const [old] = await rowsOf('SELECT kind, vendor, source FROM party_ledgers WHERE company_id = ? AND ledger_guid = ?', [companyId, guid]);
    const describeMap = (k, v) => (k === 'vendor' ? v : k === 'internal' ? 'our own registration' : k === 'other' ? 'not a marketplace' : 'not set');
    const before = describeMap(old?.kind ?? null, old?.vendor ?? null);
    const after = describeMap(kind, vendor);
    if (before !== after || (kind && old?.source !== 'person')) {
      await inTx(async (tx) => {
        await tx.execute({
          sql: `INSERT INTO party_ledgers (company_id, ledger_guid, kind, vendor, source, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
                ON CONFLICT(company_id, ledger_guid) DO UPDATE SET kind = excluded.kind, vendor = excluded.vendor,
                  source = excluded.source, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          args: [companyId, guid, kind, vendor, kind ? 'person' : null, req.user.id],
        });
        await logAction({
          client: tx, userId: req.user.id, actionType: 'PARTY_LEDGER_UPDATE', description: `${ledger.name}: ${before} → ${after}`,
          entityType: 'party_ledger', entityRef: `${companyId}:${guid}`, changes: [{ field: 'mapping', old: before, new: after }],
        });
      });
      await rematch(db);
    }
    res.json({ company_id: companyId, guid, kind, vendor, source: kind ? 'person' : null });
  } catch (err) { sendError(res, next, err); }
}

// POST /api/matching/party-ledgers/accept-suggestions { company_id? } -- every
// ledger not set yet takes the marketplace its links point to.
async function acceptSuggestions(req, res, next) {
  try {
    const companyId = req.body?.company_id == null ? null : Number(req.body.company_id);
    const rows = await rowsOf(
      `SELECT pl.company_id, pl.ledger_guid, pl.suggested_vendor, l.name FROM party_ledgers pl
         JOIN tally_companies c ON c.id = pl.company_id
         JOIN tally_ledgers l ON l.company_id = pl.company_id AND l.guid = pl.ledger_guid
        WHERE c.sync_enabled = 1 AND pl.kind IS NULL AND pl.suggested_vendor IS NOT NULL ${companyId ? 'AND pl.company_id = ?' : ''}`,
      companyId ? [companyId] : [],
    );
    if (rows.length) {
      await inTx(async (tx) => {
        for (const r of rows) {
          await tx.execute({
            sql: `UPDATE party_ledgers SET kind = 'vendor', vendor = suggested_vendor, source = 'person', updated_at = datetime('now'), updated_by = ?
                   WHERE company_id = ? AND ledger_guid = ? AND kind IS NULL`,
            args: [req.user.id, r.company_id, r.ledger_guid],
          });
        }
        await logAction({
          client: tx, userId: req.user.id, actionType: 'PARTY_LEDGERS_ACCEPT',
          description: `Accepted ${rows.length} suggested party ledger mapping${rows.length === 1 ? '' : 's'}`,
          entityType: 'party_ledger',
          changes: rows.slice(0, 100).map((r) => ({ field: r.name, old: 'not set', new: r.suggested_vendor })),
        });
      });
      await rematch(db);
    }
    res.json({ accepted: rows.length });
  } catch (err) { sendError(res, next, err); }
}

module.exports = {
  summary, results, result, run, confirm, pick, reject, undo, searchVouchers,
  getSettings, updateSettings, resetSettings, preview, vendors, updateVendor, voucherTypes,
  partyLedgers, updatePartyLedger, acceptSuggestions,
};
