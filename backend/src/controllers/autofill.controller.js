const db = require('../config/db');
const { logAction, diffFields } = require('../services/auditLog.service');
const {
  DEFAULTS, loadSettings, loadRow, shape, toColumns, validate,
} = require('../services/autofillSettings');
const { romsSettings } = require('../services/romsClient');
const {
  planAutofill, sendAutofill, approve: approveItems, retry: retryItem, overwrite: overwriteItem, actionOf,
} = require('../matching/autofill');

// Matching -> Auto-fill: what RAMS writes into ROMS, what it wrote, what ROMS
// refused, and the switches. Who may do what is the autofill.* permissions
// (routes/autofill.routes.js). Every switch, approval and overwrite is audited.

const KINDS = ['po', 'rtv'];
const STATES = ['to_check', 'checked', 'to_write', 'refused', 'differs'];
const RESULTS = ['applied', 'skipped', 'rejected'];
const MODE_TEXT = {
  off: 'Off', preview: 'Preview', approve: 'Ask first', auto: 'Automatic',
};
const FIELD_TEXT = { po: 'Bill No', rtv: 'CN No' };
const PAGE_SIZE = 50;
const PAGE_SIZE_MAX = 200;

const fail = (status, message) => Object.assign(new Error(message), { status });
// Our own refusals, and ROMS being unreachable (502/503), are told to the
// person; anything else is a server error.
const TOLD = new Set([400, 404, 409, 502, 503]);
const sendError = (res, next, err) => (TOLD.has(err.status) ? res.status(err.status).json({ message: err.message }) : next(err));
const rowsOf = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const pageOf = (q) => {
  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(q.page_size, 10) || PAGE_SIZE));
  return { page, pageSize, offset: (page - 1) * pageSize };
};
// The start of today in India, as a UTC datetime like the stored ones.
const TODAY_IST = "datetime(date('now', '+330 minutes'), '-330 minutes')";

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
  const settings = await loadSettings(db);
  const [states, events, items, runs] = await Promise.all([
    rowsOf('SELECT target_kind, state, dry, COUNT(*) AS n FROM autofill_items GROUP BY target_kind, state, dry'),
    rowsOf(`SELECT target_kind, result, COUNT(*) AS n, SUM(CASE WHEN at >= ${TODAY_IST} THEN 1 ELSE 0 END) AS today
              FROM autofill_events GROUP BY target_kind, result`),
    rowsOf("SELECT target_kind, state FROM autofill_items WHERE state IN ('to_check','checked','to_write')"),
    rowsOf(`SELECT r.id, r.trigger, r.status, r.counts, r.error, r.ms, r.started_at, r.finished_at, u.name AS by_name
              FROM autofill_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 1`),
  ]);
  const fields = {};
  for (const kind of KINDS) {
    const f = {
      mode: settings[kind === 'po' ? 'bill_mode' : 'cn_mode'],
      states: Object.fromEntries(STATES.map((s) => [s, 0])),
      refused_in_preview: 0,
      written: 0,
      written_today: 0,
      already: 0,
      rejected: 0,
      due: { write: 0, check: 0 },
    };
    for (const r of states.filter((x) => x.target_kind === kind)) {
      f.states[r.state] += Number(r.n);
      if (r.state === 'refused' && Number(r.dry)) f.refused_in_preview += Number(r.n);
    }
    for (const r of events.filter((x) => x.target_kind === kind)) {
      if (r.result === 'applied') { f.written = Number(r.n); f.written_today = Number(r.today || 0); }
      if (r.result === 'skipped') f.already = Number(r.n);
      if (r.result === 'rejected') f.rejected = Number(r.n);
    }
    for (const i of items.filter((x) => x.target_kind === kind)) {
      const a = actionOf(i, settings);
      if (a) f.due[a] += 1;
    }
    fields[kind] = f;
  }
  const last = runs[0];
  return {
    settings,
    recommended: DEFAULTS,
    fields,
    last_run: last ? {
      id: Number(last.id), trigger: last.trigger, status: last.status, by: last.by_name || null,
      counts: last.counts ? JSON.parse(last.counts) : null, error: last.error,
      ms: last.ms == null ? null : Number(last.ms), started_at: last.started_at, finished_at: last.finished_at,
    } : null,
    roms: { connected: romsSettings().configured },
  };
}

// GET /api/autofill/summary
async function summary(req, res, next) {
  try {
    res.json(await summaryData());
  } catch (err) { next(err); }
}

// ------------------------------------------------------------ lists

const ITEM_SELECT = `
  SELECT i.target_kind, i.target_id, i.po_id, i.field, i.kind, i.expected, i.expected_date, i.value, i.date, i.state, i.reason,
         i.dry, i.tries, i.tried_at, i.approved_at, i.created_at, i.updated_at, u.name AS approved_by_name,
         c.code AS company, r.vendor, r.method, r.voucher_number, r.voucher_date, p.vendor_po_id, t.rtv_no
    FROM autofill_items i
    LEFT JOIN users u ON u.id = i.approved_by
    LEFT JOIN tally_companies c ON c.id = i.company_id
    LEFT JOIN match_results r ON r.target_kind = i.target_kind AND r.target_id = i.target_id
    LEFT JOIN roms_pos p ON p.po_id = i.po_id
    LEFT JOIN roms_rtv t ON i.target_kind = 'rtv' AND t.id = CAST(i.target_id AS INTEGER)`;

const shapeItem = (r) => ({
  kind: r.target_kind,
  id: r.target_id,
  po_id: r.po_id,
  field: r.field,
  write_kind: r.kind,
  expected: r.expected,
  expected_date: r.expected_date,
  value: r.value,
  date: r.date,
  state: r.state,
  reason: r.reason,
  dry: Boolean(Number(r.dry)),
  tries: Number(r.tries),
  tried_at: r.tried_at,
  approved_by: r.approved_by_name || null,
  approved_at: r.approved_at,
  since: r.updated_at,
  company: r.company || null,
  vendor: r.vendor || null,
  method: r.method || null,
  vendor_po_id: r.vendor_po_id || null,
  rtv_no: r.rtv_no || null,
});

// GET /api/autofill/items?kind=po|rtv&state=to_check,checked&q=&page=&page_size=
async function items(req, res, next) {
  try {
    const q = req.query;
    const kind = KINDS.includes(q.kind) ? q.kind : 'po';
    const where = ['i.target_kind = ?'];
    const args = [kind];
    if (q.state) {
      const states = String(q.state).split(',').filter(Boolean);
      if (!states.length || states.some((s) => !STATES.includes(s))) return res.status(400).json({ message: 'Unknown state' });
      where.push(`i.state IN (${states.map(() => '?').join(',')})`);
      args.push(...states);
    }
    if (q.q && String(q.q).trim()) {
      const like = `%${String(q.q).trim()}%`;
      where.push('(i.po_id LIKE ? OR i.value LIKE ? OR i.expected LIKE ? OR p.vendor_po_id LIKE ? OR t.rtv_no LIKE ?)');
      args.push(like, like, like, like, like);
    }
    const { page, pageSize, offset } = pageOf(q);
    const base = `${ITEM_SELECT} WHERE ${where.join(' AND ')}`;
    const [rows, [{ total }]] = await Promise.all([
      rowsOf(`${base} ORDER BY i.created_at, i.po_id, i.target_id LIMIT ? OFFSET ?`, [...args, pageSize, offset]),
      rowsOf(`SELECT COUNT(*) AS total FROM (${base})`, args),
    ]);
    res.json({ rows: rows.map(shapeItem), total: Number(total), page, page_size: pageSize });
  } catch (err) { next(err); }
}

// GET /api/autofill/events?kind=po|rtv&result=applied&q=&page=&page_size= -- newest first
async function events(req, res, next) {
  try {
    const q = req.query;
    const kind = KINDS.includes(q.kind) ? q.kind : 'po';
    const where = ['e.target_kind = ?'];
    const args = [kind];
    if (q.result) {
      if (!RESULTS.includes(q.result)) return res.status(400).json({ message: 'Unknown result' });
      where.push('e.result = ?'); args.push(q.result);
    }
    if (q.q && String(q.q).trim()) {
      const like = `%${String(q.q).trim()}%`;
      where.push('(e.po_id LIKE ? OR e.new_value LIKE ? OR e.old_value LIKE ? OR t.rtv_no LIKE ?)');
      args.push(like, like, like, like);
    }
    const { page, pageSize, offset } = pageOf(q);
    const base = `SELECT e.*, u.name AS by_name, t.rtv_no FROM autofill_events e
                    LEFT JOIN users u ON u.id = e.by_user
                    LEFT JOIN roms_rtv t ON e.target_kind = 'rtv' AND t.id = CAST(e.target_id AS INTEGER)
                   WHERE ${where.join(' AND ')}`;
    const [rows, [{ total }]] = await Promise.all([
      rowsOf(`${base} ORDER BY e.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, offset]),
      rowsOf(`SELECT COUNT(*) AS total FROM (${base})`, args),
    ]);
    res.json({
      rows: rows.map((e) => ({
        id: Number(e.id), kind: e.target_kind, target_id: e.target_id, po_id: e.po_id, rtv_no: e.rtv_no || null, field: e.field,
        write_kind: e.kind, old_value: e.old_value, new_value: e.new_value, old_date: e.old_date, new_date: e.new_date,
        result: e.result, reason: e.reason, by: e.by_name || null, at: e.at,
      })),
      total: Number(total),
      page,
      page_size: pageSize,
    });
  } catch (err) { next(err); }
}

// ------------------------------------------------------------ settings

// GET /api/autofill/settings
async function getSettings(req, res, next) {
  try {
    res.json({ settings: await loadSettings(db), recommended: DEFAULTS });
  } catch (err) { next(err); }
}

function describe(changes) {
  return changes.map((c) => {
    if (c.field === 'bill_mode') return `Bill No auto-fill: ${MODE_TEXT[c.old]} → ${MODE_TEXT[c.new]}`;
    if (c.field === 'cn_mode') return `CN No auto-fill: ${MODE_TEXT[c.old]} → ${MODE_TEXT[c.new]}`;
    if (c.field === 'replace_typed') return Number(c.new) ? 'Typed forms of Tally\'s number are rewritten' : 'Typed forms of Tally\'s number are left alone';
    if (c.field === 'bill_date_rule') return c.new === 'keep' ? 'A Bill Date staff typed is kept' : 'The Bill Date becomes Tally\'s invoice date';
    return c.field;
  }).join(' · ');
}

// PUT /api/autofill/settings -- any subset; plans the work again.
async function updateSettings(req, res, next) {
  try {
    const current = await loadSettings(db);
    const { settings, error } = validate(req.body || {}, current);
    if (error) throw fail(400, error);
    const before = toColumns(current);
    const after = toColumns(settings);
    const changes = diffFields(before, after, Object.keys(after));
    if (changes.length) {
      await inTx(async (tx) => {
        await tx.execute({
          sql: `UPDATE autofill_settings SET ${Object.keys(after).map((k) => `${k} = ?`).join(', ')},
                  updated_at = datetime('now'), updated_by = ? WHERE id = 1`,
          args: [...Object.values(after), req.user.id],
        });
        await logAction({
          client: tx, userId: req.user.id, actionType: 'AUTOFILL_SETTINGS_UPDATE', description: describe(changes),
          entityType: 'autofill_settings', entityId: 1, changes,
        });
      });
      await planAutofill(db);
    }
    res.json({ settings: shape(await loadRow(db)), recommended: DEFAULTS, changed: changes.length });
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------ actions

// POST /api/autofill/approve { kind, ids? } -- every write waiting, or the listed rows.
async function approve(req, res, next) {
  try {
    const { kind, ids } = req.body || {};
    if (!KINDS.includes(kind)) throw fail(400, 'Say which field: po (Bill No) or rtv (CN No)');
    if (ids != null && (!Array.isArray(ids) || ids.length > 1000)) throw fail(400, 'ids must be a list of rows');
    const n = await approveItems(db, { kind, ids, userId: req.user.id });
    if (n) {
      await logAction({
        userId: req.user.id,
        actionType: 'AUTOFILL_APPROVE',
        description: `Approved ${n} ${FIELD_TEXT[kind]} write${n === 1 ? '' : 's'} into ROMS${ids ? `: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? '…' : ''}` : ''}`,
        entityType: 'autofill',
        entityRef: kind,
      });
    }
    res.json({ approved: n, summary: await summaryData() });
  } catch (err) { sendError(res, next, err); }
}

// POST /api/autofill/run -- "Write now": one time-boxed round. The page asks
// again while `more`.
async function run(req, res, next) {
  try {
    const out = await sendAutofill(db, { trigger: 'manual', userId: req.user.id });
    if (!out.ok) return res.status(502).json({ message: out.error, ...out });
    res.json({ ...out, summary: await summaryData() });
  } catch (err) { sendError(res, next, err); }
}

const rowLabel = (item) => (item.target_kind === 'po' ? `PO ${item.po_id}` : `RTV row ${item.target_id} (PO ${item.po_id})`);

// POST /api/autofill/items/:kind/:id/retry
async function retry(req, res, next) {
  try {
    const item = await retryItem(db, { kind: req.params.kind, id: req.params.id, userId: req.user.id });
    await logAction({
      userId: req.user.id,
      actionType: 'AUTOFILL_RETRY',
      description: `Asked to write ${item.value} into ${rowLabel(item)} again`,
      entityType: item.target_kind,
      entityRef: item.target_id,
    });
    res.json({ state: item.state, summary: await summaryData() });
  } catch (err) { sendError(res, next, err); }
}

// POST /api/autofill/items/:kind/:id/overwrite -- Tally's number over a
// different value staff typed, now.
async function overwrite(req, res, next) {
  try {
    const out = await overwriteItem(db, { kind: req.params.kind, id: req.params.id, user: req.user });
    const { item } = out;
    const done = out.result === 'written' || out.result === 'already';
    await logAction({
      userId: req.user.id,
      actionType: 'AUTOFILL_OVERWRITE',
      description: done
        ? `Wrote Tally's ${item.value} over "${item.expected}" on ${rowLabel(item)} in ROMS`
        : `Tried to write Tally's ${item.value} over "${item.expected}" on ${rowLabel(item)} — ROMS refused: ${out.reason || 'no reason given'}`,
      entityType: item.target_kind,
      entityRef: item.target_id,
      changes: done ? [{ field: item.field, old: item.expected, new: item.value }] : null,
    });
    res.json({ result: out.result, reason: out.reason, summary: await summaryData() });
  } catch (err) { sendError(res, next, err); }
}

module.exports = {
  summary, items, events, getSettings, updateSettings, approve, run, retry, overwrite, summaryData,
};
