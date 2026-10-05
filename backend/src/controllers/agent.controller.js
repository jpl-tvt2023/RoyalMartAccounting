const db = require('../config/db');
const { SYNC_FROM } = require('../config/env');
const { logAction } = require('../services/auditLog.service');
const { codeForState, syncShape } = require('../services/tallyCompany');

// The Connector API (/api/agent/*, Connector token only -- routes/agent.routes.js).
// One sync of one company is a run:
//
//   POST /heartbeat                 every minute: status in, enabled companies out
//   POST /runs                      start {company_id, kind, altVchId, altMstId}
//   POST /runs/:id/masters          complete master lists
//   POST /runs/:id/vouchers         up to 250 vouchers
//   POST /runs/:id/reconcile        a period's full GUID list from Tally
//   POST /runs/:id/finish           {ok, errors, backfillDone}
//
// Every write is idempotent on (company, Tally GUID), so the Connector may
// resend anything. The watermarks move only in finish, on ok, to the counters
// the run started with -- so a run that dies part-way is simply run again.

const KINDS = ['light', 'heavy', 'backfill', 'resync'];
const MAX_VOUCHERS = 250;
const MAX_LIST = 20000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ABANDONED = JSON.stringify(['Abandoned: a newer run started before this one finished']);

const fail = (status, message) => Object.assign(new Error(message), { status });
const bad = (message) => fail(400, message);
const sendError = (res, next, err) => (err.status && err.status < 500
  ? res.status(err.status).json({ message: err.message })
  : next(err));

const text = (v, max = 500) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const int = (v) => {
  if (Number.isInteger(v)) return v;
  return v != null && /^-?\d+$/.test(String(v).trim()) ? Number(v) : null;
};
const real = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
// Rupees as Tally exports them -> whole paise.
const paise = (v) => {
  const n = real(v);
  return n == null ? null : Math.round(n * 100);
};
const flag = (v) => (v ? 1 : 0);
const json = (v) => (v == null ? null : JSON.stringify(v));
const placeholders = (n) => Array(n).fill('?').join(', ');
const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// ------------------------------------------------------------ heartbeat

// POST /api/agent/heartbeat { version, tally, companies: [{guid, name, state,
// booksFrom, altVchId, altMstId}], activity, lastError }
//
// Lists every company the Connector reports (a new GUID becomes a new row,
// sync off) and answers with the companies whose sync is ON, which are the
// only ones the Connector may read.
async function heartbeat(req, res, next) {
  try {
    const body = req.body || {};
    const reported = Array.isArray(body.companies) ? body.companies : [];
    if (reported.length > 100) throw bad('Too many companies in one heartbeat');
    const seen = [];
    for (const c of reported) {
      const guid = text(c && c.guid, 100);
      const name = text(c && c.name, 200);
      if (!guid || !name) continue;
      seen.push({
        guid, name, state: text(c.state, 60),
        booksFrom: ISO.test(c.booksFrom || '') ? c.booksFrom : null,
        altVchId: int(c.altVchId), altMstId: int(c.altMstId),
      });
    }
    const status = JSON.stringify({
      tally: body.tally && typeof body.tally === 'object' ? body.tally : null,
      companies: seen.map(({ guid, name, altVchId, altMstId }) => ({ guid, name, altVchId, altMstId })),
      activity: body.activity && typeof body.activity === 'object' ? body.activity : null,
      lastError: text(body.lastError, 1000),
    }).slice(0, 50000);

    const known = new Set();
    if (seen.length) {
      const { rows } = await db.execute({
        sql: `SELECT guid FROM tally_companies WHERE guid IN (${placeholders(seen.length)})`,
        args: seen.map((c) => c.guid),
      });
      rows.forEach((r) => known.add(r.guid));
    }

    const tx = await db.transaction('write');
    try {
      await tx.execute({
        sql: "UPDATE agents SET last_seen_at = datetime('now'), version = ?, status = ? WHERE id = ?",
        args: [text(body.version, 40), status, req.agent.id],
      });
      for (const c of seen) {
        const { rows: [row] } = await tx.execute({
          sql: `INSERT INTO tally_companies (guid, name, state_name, code, books_from, last_seen_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(guid) DO UPDATE SET name = excluded.name, state_name = excluded.state_name,
                  books_from = excluded.books_from, last_seen_at = excluded.last_seen_at
                RETURNING id`,
          args: [c.guid, c.name, c.state, codeForState(c.state), c.booksFrom],
        });
        const id = Number(row.id);
        if (!known.has(c.guid)) {
          await logAction({
            client: tx, actionType: 'TALLY_COMPANY_SEEN', entityType: 'tally_company', entityId: id,
            description: `Connector "${req.agent.name}" found Tally company ${c.name}. Its sync is off until an Admin or Owner turns it on.`,
          });
        }
        // Tally's counters equal the watermarks: RAMS is current as of now.
        if (c.altVchId != null && c.altMstId != null) {
          await tx.execute({
            sql: `UPDATE tally_sync_state SET last_checked_at = datetime('now')
                   WHERE company_id = ? AND backfill_done = 1 AND alt_vch_id = ? AND alt_mst_id = ?`,
            args: [id, c.altVchId, c.altMstId],
          });
        }
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    const { rows } = await db.execute(
      `SELECT c.id, c.guid, c.name, c.code, s.*
         FROM tally_companies c LEFT JOIN tally_sync_state s ON s.company_id = c.id
        WHERE c.sync_enabled = 1
        ORDER BY c.code, c.name`,
    );
    res.json({
      companies: rows.map((r) => ({ id: Number(r.id), guid: r.guid, name: r.name, code: r.code, sync: syncShape(r) })),
      settings: { syncFrom: SYNC_FROM },
      commands: [],
    });
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------------ runs

async function stateOf(client, companyId) {
  const { rows } = await client.execute({ sql: 'SELECT * FROM tally_sync_state WHERE company_id = ?', args: [companyId] });
  return rows[0] || {};
}

// POST /api/agent/runs { company_id, kind, altVchId, altMstId }
// altVchId / altMstId are Tally's counters read just before the run began.
async function startRun(req, res, next) {
  try {
    const body = req.body || {};
    const companyId = int(body.company_id);
    const { kind } = body;
    const altVchId = int(body.altVchId);
    const altMstId = int(body.altMstId);
    if (!companyId) throw bad('company_id is required');
    if (!KINDS.includes(kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
    if (altVchId == null || altMstId == null || altVchId < 0 || altMstId < 0) throw bad('altVchId and altMstId are required');

    const { rows: [company] } = await db.execute({ sql: 'SELECT id, name, sync_enabled FROM tally_companies WHERE id = ?', args: [companyId] });
    if (!company) throw fail(404, 'No such company');
    if (!company.sync_enabled) throw fail(409, `Sync is turned off for ${company.name}`);

    const tx = await db.transaction('write');
    let runId;
    let state;
    try {
      await tx.execute({
        sql: "UPDATE tally_sync_runs SET status = 'failed', finished_at = datetime('now'), errors = ? WHERE company_id = ? AND status = 'running'",
        args: [ABANDONED, companyId],
      });
      await tx.execute({ sql: 'INSERT OR IGNORE INTO tally_sync_state (company_id) VALUES (?)', args: [companyId] });
      const before = await stateOf(tx, companyId);
      if (kind === 'backfill' && before.backfill_done) {
        throw fail(409, 'The backfill is already complete. Start a resync to pull everything again.');
      }
      if ((kind === 'light' || kind === 'heavy') && !before.backfill_done) {
        throw fail(409, 'The backfill has not finished yet');
      }
      if (kind === 'resync') {
        // Everything is pulled again: forget the watermarks and the progress.
        await tx.execute({
          sql: `UPDATE tally_sync_state SET alt_vch_id = NULL, alt_mst_id = NULL, backfill_through = NULL,
                  backfill_done = 0, needs_resync = 0, backfill_alt_vch_id = ?, backfill_alt_mst_id = ?,
                  updated_at = datetime('now')
                 WHERE company_id = ?`,
          args: [altVchId, altMstId, companyId],
        });
      } else if (kind === 'backfill' && before.backfill_through == null) {
        await tx.execute({
          sql: "UPDATE tally_sync_state SET backfill_alt_vch_id = ?, backfill_alt_mst_id = ?, updated_at = datetime('now') WHERE company_id = ?",
          args: [altVchId, altMstId, companyId],
        });
      }
      const { rows } = await tx.execute({
        sql: 'INSERT INTO tally_sync_runs (company_id, agent_id, kind, alt_vch_id, alt_mst_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
        args: [companyId, req.agent.id, kind, altVchId, altMstId],
      });
      runId = Number(rows[0].id);
      state = await stateOf(tx, companyId);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    res.status(201).json({ run_id: runId, sync: syncShape(state) });
  } catch (err) { sendError(res, next, err); }
}

// The run named in the URL, open, belonging to this Connector, and for a
// company whose sync is still on.
async function openRun(req) {
  const id = int(req.params.id);
  const { rows: [run] } = await db.execute({
    sql: `SELECT r.*, c.name AS company_name, c.gstin AS company_gstin, c.sync_enabled
            FROM tally_sync_runs r JOIN tally_companies c ON c.id = r.company_id
           WHERE r.id = ?`,
    args: [id],
  });
  if (!run) throw fail(404, 'No such run');
  if (Number(run.agent_id) !== req.agent.id) throw fail(403, 'This run belongs to another Connector');
  if (run.status !== 'running') throw fail(409, `This run is already ${run.status}`);
  if (!run.sync_enabled) throw fail(409, `Sync was turned off for ${run.company_name}`);
  return { ...run, id: Number(run.id), company_id: Number(run.company_id) };
}

// --------------------------------------------------------------- masters

// Each kind: its table, its columns after (company_id, guid), and how a
// Connector record fills them. `renames` marks kinds whose names voucher lines
// carry, so renaming one makes the mirrored vouchers stale.
const MASTERS = {
  groups: {
    table: 'tally_groups', renames: false,
    cols: ['name', 'parent', 'reserved_name', 'alter_id'],
    values: (m) => [text(m.name, 300), text(m.parent, 300), text(m.reserved, 100), int(m.alterId)],
  },
  ledgers: {
    table: 'tally_ledgers', renames: true,
    cols: ['name', 'parent', 'aliases', 'gstin', 'gstins', 'state', 'is_bill_wise', 'master_id', 'alter_id'],
    values: (m) => {
      const gstins = Array.isArray(m.gstins) ? m.gstins.map((g) => text(g, 20)).filter(Boolean) : [];
      return [
        text(m.name, 300), text(m.parent, 300), json(Array.isArray(m.aliases) ? m.aliases.slice(0, 20) : []),
        gstins[0] || null, json(gstins), text(m.state, 60), flag(m.billWise), int(m.masterId), int(m.alterId),
      ];
    },
  },
  stockItems: {
    table: 'tally_stock_items', renames: true,
    cols: ['name', 'parent', 'aliases', 'base_units', 'hsn', 'alter_id'],
    values: (m) => [
      text(m.name, 300), text(m.parent, 300), json(Array.isArray(m.aliases) ? m.aliases.slice(0, 20) : []),
      text(m.baseUnits, 40), text(m.hsn, 20), int(m.alterId),
    ],
  },
  voucherTypes: {
    table: 'tally_voucher_types', renames: true,
    cols: ['name', 'parent', 'reserved_name', 'numbering', 'is_active', 'alter_id'],
    values: (m) => [
      text(m.name, 300), text(m.parent, 300), text(m.reserved, 100), text(m.numbering, 100),
      flag(m.active !== false), int(m.alterId),
    ],
  },
};

// POST /api/agent/runs/:id/masters { groups?, ledgers?, stockItems?, voucherTypes? }
// Each list sent is COMPLETE, so what it lacks was deleted in Tally. A kind the
// Connector could not read is simply left out, and nothing of it is touched.
async function masters(req, res, next) {
  try {
    const run = await openRun(req);
    const body = req.body || {};
    const stmts = [];
    const result = { upserted: 0, unchanged: 0, deleted: 0, renamed: 0 };

    for (const [key, spec] of Object.entries(MASTERS)) {
      const list = body[key];
      if (list == null) continue;
      if (!Array.isArray(list)) throw bad(`${key} must be a list`);
      if (list.length > MAX_LIST) throw bad(`${key}: at most ${MAX_LIST} at a time`);
      const missingGuid = list.filter((m) => !text(m && m.guid, 100) || !text(m && m.name, 300)).length;
      if (missingGuid) throw bad(`${key}: ${missingGuid} record(s) without a GUID or name`);

      const { rows: stored } = await db.execute({
        sql: `SELECT guid, name, alter_id, deleted_at FROM ${spec.table} WHERE company_id = ?`,
        args: [run.company_id],
      });
      const byGuid = new Map(stored.map((r) => [r.guid, r]));
      const incoming = new Set();
      const upsert = `INSERT INTO ${spec.table} (company_id, guid, ${spec.cols.join(', ')})
                      VALUES (?, ?, ${placeholders(spec.cols.length)})
                      ON CONFLICT(company_id, guid) DO UPDATE SET
                        ${spec.cols.map((c) => `${c} = excluded.${c}`).join(', ')},
                        deleted_at = NULL, updated_at = datetime('now')`;
      for (const m of list) {
        const guid = text(m.guid, 100);
        if (incoming.has(guid)) continue;
        incoming.add(guid);
        const values = spec.values(m);
        const before = byGuid.get(guid);
        if (before && !before.deleted_at) {
          if (spec.renames && before.name !== values[0]) result.renamed++;
          if (int(m.alterId) != null && Number(before.alter_id) === int(m.alterId) && before.name === values[0]) {
            result.unchanged++;
            continue;
          }
        }
        stmts.push({ sql: upsert, args: [run.company_id, guid, ...values] });
        result.upserted++;
      }
      const gone = stored.filter((r) => !r.deleted_at && !incoming.has(r.guid)).map((r) => r.guid);
      for (const part of chunks(gone, 500)) {
        stmts.push({
          sql: `UPDATE ${spec.table} SET deleted_at = datetime('now') WHERE company_id = ? AND guid IN (${placeholders(part.length)})`,
          args: [run.company_id, ...part],
        });
      }
      result.deleted += gone.length;
    }

    stmts.push({
      sql: 'UPDATE tally_sync_runs SET masters_upserted = masters_upserted + ?, masters_deleted = masters_deleted + ? WHERE id = ?',
      args: [result.upserted, result.deleted, run.id],
    });
    // A rename leaves the old name on mirrored voucher lines. Pull everything
    // again -- unless this run is already doing that from the start.
    const state = await stateOf(db, run.company_id);
    const pullingAllAnyway = (run.kind === 'resync' || run.kind === 'backfill') && state.backfill_through == null;
    if (result.renamed && !pullingAllAnyway) {
      stmts.push({
        sql: "UPDATE tally_sync_state SET needs_resync = 1, updated_at = datetime('now') WHERE company_id = ?",
        args: [run.company_id],
      });
    }
    await db.batch(stmts, 'write');
    res.json(result);
  } catch (err) { sendError(res, next, err); }
}

// -------------------------------------------------------------- vouchers

const VOUCHER_COLS = [
  'master_id', 'alter_id', 'date', 'voucher_type', 'base_type', 'number', 'reference', 'reference_date',
  'party', 'party_gstin', 'cmp_gstin', 'narration', 'is_invoice', 'is_cancelled', 'is_optional', 'total_paise',
];
const UPSERT_VOUCHER = `INSERT INTO tally_vouchers (company_id, guid, ${VOUCHER_COLS.join(', ')}, last_run_id)
  VALUES (?, ?, ${placeholders(VOUCHER_COLS.length)}, ?)
  ON CONFLICT(company_id, guid) DO UPDATE SET
    ${VOUCHER_COLS.map((c) => `${c} = excluded.${c}`).join(', ')},
    last_run_id = excluded.last_run_id, deleted_at = NULL, updated_at = datetime('now')`;
const VOUCHER_ID = '(SELECT id FROM tally_vouchers WHERE company_id = ? AND guid = ?)';
const CHILD_TABLES = ['tally_vch_ledger_lines', 'tally_vch_bill_allocations', 'tally_vch_inventory_lines', 'tally_vch_orders'];

// One child table's rows as a single multi-row INSERT, each row finding its
// voucher by (company, guid) -- the voucher's id is not known client-side.
function childInsert(table, cols, rows, companyId, guid) {
  if (!rows.length) return null;
  const one = `(${VOUCHER_ID}, ${placeholders(cols.length)})`;
  return {
    sql: `INSERT INTO ${table} (voucher_id, ${cols.join(', ')}) VALUES ${rows.map(() => one).join(', ')}`,
    args: rows.flatMap((r) => [companyId, guid, ...r]),
  };
}

function checkVoucher(v, i) {
  const where = `vouchers[${i}]`;
  if (!v || typeof v !== 'object') throw bad(`${where} is not a voucher`);
  if (!text(v.guid, 100)) throw bad(`${where} has no GUID`);
  if (int(v.alterId) == null) throw bad(`${where} (${v.guid}) has no AlterID`);
  if (!ISO.test(v.date || '')) throw bad(`${where} (${v.guid}) has no date`);
  if (!text(v.type, 200)) throw bad(`${where} (${v.guid}) has no voucher type`);
}

function voucherStatements(v, companyId, runId, replaceLines) {
  const guid = text(v.guid, 100);
  const ledgerLines = Array.isArray(v.ledgerLines) ? v.ledgerLines : [];
  const inventoryLines = Array.isArray(v.inventoryLines) ? v.inventoryLines : [];
  const orders = Array.isArray(v.orders) ? v.orders : [];
  const stmts = [{
    sql: UPSERT_VOUCHER,
    args: [
      companyId, guid,
      int(v.masterId), int(v.alterId), v.date, text(v.type, 200), text(v.baseType, 60) || 'Unknown',
      text(v.number, 200), text(v.reference, 200), ISO.test(v.referenceDate || '') ? v.referenceDate : null,
      text(v.party, 300), text(v.partyGstin, 20), text(v.cmpGstin, 20), text(v.narration, 300),
      flag(v.invoice), flag(v.cancelled), flag(v.optional), paise(v.total),
      runId,
    ],
  }];
  if (replaceLines) {
    for (const table of CHILD_TABLES) {
      stmts.push({ sql: `DELETE FROM ${table} WHERE voucher_id = ${VOUCHER_ID}`, args: [companyId, guid] });
    }
  }
  const ledgerRows = [];
  const billRows = [];
  ledgerLines.forEach((l, n) => {
    const ledger = text(l && l.ledger, 300);
    if (!ledger) return;
    ledgerRows.push([n, ledger, paise(l.amount), flag(l.isParty), flag(l.debit)]);
    for (const b of Array.isArray(l.bills) ? l.bills : []) {
      billRows.push([n, ledger, text(b.name, 200), text(b.type, 60), paise(b.amount)]);
    }
  });
  const inventoryRows = inventoryLines
    .filter((i) => i && text(i.item, 300))
    .map((i, n) => [
      n, text(i.item, 300), real(i.qty), text(i.unit, 40), real(i.rate), paise(i.amount), text(i.direction, 10),
      json(Array.isArray(i.godowns) ? i.godowns.slice(0, 20) : []), json(Array.isArray(i.orderNos) ? i.orderNos.slice(0, 20) : []),
    ]);
  const orderRows = orders
    .filter((o) => o && text(o.no, 200))
    .map((o) => [text(o.no, 200), ISO.test(o.date || '') ? o.date : null]);

  return stmts.concat([
    childInsert('tally_vch_ledger_lines', ['line_no', 'ledger', 'amount_paise', 'is_party', 'is_debit'], ledgerRows, companyId, guid),
    childInsert('tally_vch_bill_allocations', ['line_no', 'ledger', 'name', 'bill_type', 'amount_paise'], billRows, companyId, guid),
    childInsert('tally_vch_inventory_lines',
      ['line_no', 'item', 'qty', 'unit', 'rate', 'amount_paise', 'direction', 'godowns', 'order_nos'], inventoryRows, companyId, guid),
    childInsert('tally_vch_orders', ['order_no', 'order_date'], orderRows, companyId, guid),
  ].filter(Boolean));
}

// POST /api/agent/runs/:id/vouchers { vouchers: [...] }
// The same batch may be sent any number of times. A voucher older than the
// stored copy (lower AlterID) is skipped, and everything else replaces the
// stored voucher together with all its lines.
async function vouchers(req, res, next) {
  try {
    const run = await openRun(req);
    const list = (req.body || {}).vouchers;
    if (!Array.isArray(list) || !list.length) throw bad('vouchers must be a non-empty list');
    if (list.length > MAX_VOUCHERS) throw bad(`At most ${MAX_VOUCHERS} vouchers at a time`);
    list.forEach(checkVoucher);

    // Every voucher in a company carries that company's GSTIN. RAMS learns it
    // from the first batch and refuses any batch that disagrees: that is
    // another company's data, whatever Tally was asked for.
    const gstins = [...new Set(list.map((v) => text(v.cmpGstin, 20)).filter(Boolean))];
    if (gstins.length > 1) throw bad(`These vouchers carry more than one company GSTIN (${gstins.join(', ')})`);
    const learnGstin = gstins.length && !run.company_gstin ? gstins[0] : null;
    if (gstins.length && run.company_gstin && gstins[0] !== run.company_gstin) {
      throw bad(`These vouchers carry company GSTIN ${gstins[0]}, but ${run.company_name} is ${run.company_gstin}. Is the right company loaded in Tally?`);
    }

    const byGuid = new Map();
    for (const v of list) byGuid.set(text(v.guid, 100), v); // a repeated GUID: the last copy wins
    const guids = [...byGuid.keys()];
    const { rows: stored } = await db.execute({
      sql: `SELECT guid, alter_id FROM tally_vouchers WHERE company_id = ? AND guid IN (${placeholders(guids.length)})`,
      args: [run.company_id, ...guids],
    });
    const storedAlter = new Map(stored.map((r) => [r.guid, Number(r.alter_id)]));

    const stmts = [];
    let upserted = 0;
    let skipped = 0;
    for (const [guid, v] of byGuid) {
      const before = storedAlter.get(guid);
      if (before != null && before > int(v.alterId)) { skipped++; continue; }
      stmts.push(...voucherStatements(v, run.company_id, run.id, before != null));
      upserted++;
    }
    if (learnGstin) {
      stmts.push({ sql: 'UPDATE tally_companies SET gstin = ? WHERE id = ? AND gstin IS NULL', args: [learnGstin, run.company_id] });
    }
    stmts.push({
      sql: 'UPDATE tally_sync_runs SET vouchers_upserted = vouchers_upserted + ?, vouchers_skipped = vouchers_skipped + ? WHERE id = ?',
      args: [upserted, skipped, run.id],
    });
    await db.batch(stmts, 'write');
    if (learnGstin) {
      await logAction({
        actionType: 'TALLY_COMPANY_GSTIN', entityType: 'tally_company', entityId: run.company_id,
        description: `${run.company_name}: company GSTIN ${learnGstin} learned from its vouchers`,
        changes: [{ field: 'gstin', old: null, new: learnGstin }],
      });
    }
    res.json({ upserted, skippedOlder: skipped });
  } catch (err) { sendError(res, next, err); }
}

// ------------------------------------------------------------- reconcile

// POST /api/agent/runs/:id/reconcile { from, to, vouchers: [{guid, alterId}] }
// `vouchers` is EVERY voucher Tally holds dated from..to for this company.
// Stored vouchers in that period that Tally no longer has are marked deleted.
// The answer says what RAMS lacks (missing) or holds an older copy of (stale),
// so the Connector can pull that period again.
async function reconcile(req, res, next) {
  try {
    const run = await openRun(req);
    const { from, to, vouchers: list } = req.body || {};
    if (!ISO.test(from || '') || !ISO.test(to || '') || from > to) throw bad('from and to must be YYYY-MM-DD, from <= to');
    if (!Array.isArray(list)) throw bad('vouchers must be a list');
    if (list.length > MAX_LIST) throw bad(`At most ${MAX_LIST} vouchers at a time`);

    const inTally = new Map();
    for (const v of list) {
      const guid = text(v && v.guid, 100);
      if (!guid) throw bad('Every voucher needs a GUID');
      inTally.set(guid, int(v.alterId));
    }
    const { rows: stored } = await db.execute({
      sql: 'SELECT guid, alter_id FROM tally_vouchers WHERE company_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?',
      args: [run.company_id, from, to],
    });
    const storedAlter = new Map(stored.map((r) => [r.guid, Number(r.alter_id)]));

    let missing = 0;
    let stale = 0;
    for (const [guid, alterId] of inTally) {
      if (!storedAlter.has(guid)) missing++;
      else if (alterId != null && storedAlter.get(guid) < alterId) stale++;
    }
    const gone = stored.filter((r) => !inTally.has(r.guid)).map((r) => r.guid);

    const stmts = chunks(gone, 500).map((part) => ({
      sql: `UPDATE tally_vouchers SET deleted_at = datetime('now'), last_run_id = ?
             WHERE company_id = ? AND deleted_at IS NULL AND guid IN (${placeholders(part.length)})`,
      args: [run.id, run.company_id, ...part],
    }));
    stmts.push({ sql: 'UPDATE tally_sync_runs SET vouchers_deleted = vouchers_deleted + ? WHERE id = ?', args: [gone.length, run.id] });
    // A backfill goes month by month in date order: a reconciled month has been
    // stored whole, so an interrupted backfill can resume after it.
    if (run.kind === 'backfill' || run.kind === 'resync') {
      stmts.push({
        sql: `UPDATE tally_sync_state SET backfill_through = ?, updated_at = datetime('now')
               WHERE company_id = ? AND (backfill_through IS NULL OR backfill_through < ?)`,
        args: [to, run.company_id, to],
      });
    }
    await db.batch(stmts, 'write');
    res.json({ deleted: gone.length, missing, stale });
  } catch (err) { sendError(res, next, err); }
}

// ----------------------------------------------------------------- finish

// POST /api/agent/runs/:id/finish { ok, errors?, backfillDone? }
// The only place a watermark moves, and only for a run that ended ok.
async function finish(req, res, next) {
  try {
    const run = await openRun(req);
    const body = req.body || {};
    const ok = body.ok === true;
    const errors = Array.isArray(body.errors) ? body.errors.slice(0, 50).map((e) => text(e, 1000)).filter(Boolean) : [];

    const tx = await db.transaction('write');
    let state;
    try {
      await tx.execute({
        sql: "UPDATE tally_sync_runs SET status = ?, finished_at = datetime('now'), errors = ? WHERE id = ?",
        args: [ok ? 'ok' : 'failed', errors.length ? JSON.stringify(errors) : null, run.id],
      });
      if (ok && (run.kind === 'light' || run.kind === 'heavy')) {
        await tx.execute({
          sql: `UPDATE tally_sync_state SET alt_vch_id = ?, alt_mst_id = ?, last_light_at = datetime('now'),
                  last_heavy_at = CASE WHEN ? THEN datetime('now') ELSE last_heavy_at END,
                  updated_at = datetime('now')
                 WHERE company_id = ? AND backfill_done = 1`,
          args: [run.alt_vch_id, run.alt_mst_id, run.kind === 'heavy' ? 1 : 0, run.company_id],
        });
      }
      if (ok && (run.kind === 'backfill' || run.kind === 'resync') && body.backfillDone === true) {
        // The watermarks become the counters from when the backfill began, so
        // the next light sync fetches whatever was altered while it ran.
        await tx.execute({
          sql: `UPDATE tally_sync_state SET backfill_done = 1, alt_vch_id = backfill_alt_vch_id,
                  alt_mst_id = backfill_alt_mst_id, last_heavy_at = datetime('now'), updated_at = datetime('now')
                 WHERE company_id = ? AND backfill_through IS NOT NULL`,
          args: [run.company_id],
        });
      }
      state = await stateOf(tx, run.company_id);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    res.json({ sync: syncShape(state) });
  } catch (err) { sendError(res, next, err); }
}

module.exports = { heartbeat, startRun, masters, vouchers, reconcile, finish, MAX_VOUCHERS };
