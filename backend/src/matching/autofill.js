// Auto-fill: Tally's numbers into the ROMS fields they belong in -- a linked
// PO's Builty Bill No + Bill Date, a linked RTV row's Credit Note No + CN Date
// -- through ROMS's POST /api/integration/autofill (romsClient.autofill).
//
//   planAutofill  after every match: each linked row's fill (engine.js) becomes
//                 the open work in autofill_items. RAMS only, no ROMS call.
//   sendAutofill  sends that work to ROMS as each field's mode says, in
//                 batches, until a time box ends (a Vercel request has a time
//                 limit) -- the Connector and the page call it again while
//                 `more`.
//   overwrite     a person writes Tally's number over a value that is not a
//                 form of it.
//
// ROMS compares each field with the value RAMS read and refuses if a person
// changed it since, so a fresh edit in ROMS is never overwritten. A repeat of
// a write that landed comes back "Already set", so a retry is always safe.
const { loadSettings } = require('../services/autofillSettings');
const { createRomsClient, romsSettings: readRomsSettings, RomsError } = require('../services/romsClient');

const TARGETS = {
  po: { field: 'bill_no', target: 'bill', mode: 'bill_mode' },
  rtv: { field: 'cn_number', target: 'rtv_cn', mode: 'cn_mode' },
};
const BATCH = 25;
// Stop starting batches after this long, so one request stays well inside
// Vercel's limit. The caller asks again while `more`.
const DEADLINE_MS = 30000;
// A round still marked running after this long died.
const STALE_MINUTES = 10;
// After a failed round (ROMS unreachable), the Connector is asked again only
// after this long. Write now still works at once.
const RETRY_AFTER_FAILED_MINUTES = 10;
const PLAN_COLS = ['kind', 'expected', 'expected_date', 'value', 'date'];
const STMT_BATCH = 400;

// How a link was found, for the note ROMS keeps with the change.
const HOW = {
  order_no: 'Buyer\'s Order No',
  order_no_label: 'Buyer\'s Order No',
  order_no_split: 'Buyer\'s Order No',
  bill_no: 'Bill No',
  bill_serial: 'Bill No',
  agst_ref: 'the credit note\'s Agst Ref',
  cn_number: 'CN No',
  cn_number_agst_ref: 'CN No',
  person: 'a person in RAMS',
};

const fail = (status, message) => Object.assign(new Error(message), { status });
const norm = (v) => (v == null || v === '' ? null : String(v));
const parse = (v) => {
  try { return v ? JSON.parse(v) : null; } catch { return null; }
};

async function writeBatches(client, stmts) {
  for (let i = 0; i < stmts.length; i += STMT_BATCH) await client.batch(stmts.slice(i, i + STMT_BATCH), 'write');
}

// ------------------------------------------------------------ planning

// What to write for one linked row, or null: the engine's fill under the
// auto-fill settings.
function wanted(kind, fill, s) {
  if (!fill || !fill.value || !fill.date) return null;
  const currentDate = fill.current_date || null;
  // The Bill Date staff typed is kept when the rule says so. ROMS writes the
  // date with the number, so it is sent back as it is.
  const date = kind === 'po' && s.bill_date_rule === 'keep' && currentDate ? currentDate : fill.date;
  let k;
  if (fill.kind === 'fill') k = 'fill';
  else if (fill.kind === 'replace') {
    if (!s.replace_typed) return null;
    k = 'replace';
  } else if (fill.kind === 'differs') k = 'differs';
  else if (fill.kind === 'same') {
    if (date === currentDate) return null;
    k = 'date';
  } else return null;
  return { kind: k, expected: fill.current || null, expected_date: currentDate, value: fill.value, date };
}

// match_results -> autofill_items. An unchanged plan keeps its state, so a
// refusal is not sent again every hour. A changed one starts over.
async function planAutofill(client, { settings } = {}) {
  const s = settings || await loadSettings(client);
  const [{ rows: results }, { rows: items }] = await Promise.all([
    client.execute("SELECT target_kind, target_id, po_id, company_id, fill FROM match_results WHERE outcome = 'linked' AND fill IS NOT NULL"),
    client.execute(`SELECT target_kind, target_id, ${PLAN_COLS.join(', ')} FROM autofill_items`),
  ]);
  const open = new Map(items.map((i) => [`${i.target_kind}|${i.target_id}`, i]));
  const seen = new Set();
  const stmts = [];
  let added = 0;
  let changed = 0;
  for (const r of results) {
    const w = wanted(r.target_kind, parse(r.fill), s);
    if (!w) continue;
    const k = `${r.target_kind}|${r.target_id}`;
    seen.add(k);
    const old = open.get(k);
    if (old && PLAN_COLS.every((c) => norm(old[c]) === norm(w[c]))) continue;
    if (old) changed += 1;
    else added += 1;
    stmts.push({
      sql: `INSERT INTO autofill_items (target_kind, target_id, po_id, field, kind, expected, expected_date, value, date, company_id, state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(target_kind, target_id) DO UPDATE SET
              po_id = excluded.po_id, kind = excluded.kind, expected = excluded.expected, expected_date = excluded.expected_date,
              value = excluded.value, date = excluded.date, company_id = excluded.company_id, state = excluded.state,
              reason = NULL, dry = 0, approved_by = NULL, approved_at = NULL, tries = 0, tried_at = NULL,
              updated_at = datetime('now')`,
      args: [r.target_kind, r.target_id, r.po_id, TARGETS[r.target_kind].field, w.kind, w.expected, w.expected_date,
        w.value, w.date, r.company_id == null ? null : Number(r.company_id), w.kind === 'differs' ? 'differs' : 'to_check'],
    });
  }
  const gone = [...open.entries()].filter(([k]) => !seen.has(k)).map(([, i]) => i);
  for (const i of gone) {
    stmts.push({ sql: 'DELETE FROM autofill_items WHERE target_kind = ? AND target_id = ?', args: [i.target_kind, i.target_id] });
  }
  await writeBatches(client, stmts);
  return { added, changed, removed: gone.length };
}

// ------------------------------------------------------------ what is due

// Per item, by its field's mode: 'write', 'check' (a dry run) or null.
function actionOf(item, s) {
  const mode = s[TARGETS[item.target_kind].mode];
  if (mode === 'auto') return ['to_check', 'checked', 'to_write'].includes(item.state) ? 'write' : null;
  if (mode === 'approve') return item.state === 'to_write' ? 'write' : item.state === 'to_check' ? 'check' : null;
  if (mode === 'preview') return item.state === 'to_check' ? 'check' : null;
  return null;
}

async function openWork(client, s) {
  const { rows } = await client.execute(`
    SELECT i.*, c.code AS company, r.method, u.name AS approved_by_name
      FROM autofill_items i
      LEFT JOIN tally_companies c ON c.id = i.company_id
      LEFT JOIN match_results r ON r.target_kind = i.target_kind AND r.target_id = i.target_id
      LEFT JOIN users u ON u.id = i.approved_by
     WHERE i.state IN ('to_check','checked','to_write')
     ORDER BY i.created_at, i.target_kind, i.po_id, i.target_id`);
  const write = [];
  const check = [];
  for (const item of rows) {
    const a = actionOf(item, s);
    if (a === 'write') write.push(item);
    if (a === 'check') check.push(item);
  }
  return { write, check };
}

// Should the Connector send auto-fill now? When something is due under the
// modes, and no round is running.
async function autofillDue(client) {
  const s = await loadSettings(client);
  if (s.bill_mode === 'off' && s.cn_mode === 'off') return { due: false };
  if (!readRomsSettings().configured) return { due: false };
  // Not while a round runs, nor for a while after one failed (ROMS down), so
  // the Connector doesn't knock every minute.
  const { rows: [busy] } = await client.execute({
    sql: `SELECT 1 FROM autofill_runs
           WHERE (status = 'running' AND started_at > datetime('now', ?))
              OR (id = (SELECT MAX(id) FROM autofill_runs) AND status = 'failed' AND finished_at > datetime('now', ?))`,
    args: [`-${STALE_MINUTES} minutes`, `-${RETRY_AFTER_FAILED_MINUTES} minutes`],
  });
  if (busy) return { due: false };
  const { write, check } = await openWork(client, s);
  if (write.length) return { due: true, why: `${write.length} to write into ROMS`, count: write.length + check.length };
  if (check.length) return { due: true, why: `${check.length} to check with ROMS`, count: check.length };
  return { due: false };
}

// The modes and the last round, as the Connector's `status` shows them.
async function lastAutofill(client) {
  const s = await loadSettings(client);
  const { rows: [r] } = await client.execute('SELECT status, started_at, finished_at, counts, error FROM autofill_runs ORDER BY id DESC LIMIT 1');
  return {
    billMode: s.bill_mode,
    cnMode: s.cn_mode,
    last: r ? {
      status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error || null, counts: r.counts ? JSON.parse(r.counts) : null,
    } : null,
  };
}

// ------------------------------------------------------------ sending

async function takeLock(client, trigger, userId) {
  await client.execute({
    sql: `UPDATE autofill_runs SET status = 'failed', error = 'Abandoned: it never finished', finished_at = datetime('now')
           WHERE status = 'running' AND started_at <= datetime('now', ?)`,
    args: [`-${STALE_MINUTES} minutes`],
  });
  const { rows } = await client.execute({
    sql: `INSERT INTO autofill_runs (trigger, user_id)
          SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM autofill_runs WHERE status = 'running')
          RETURNING id`,
    args: [trigger, userId],
  });
  if (!rows.length) throw fail(409, 'Auto-fill is already writing to ROMS — it carries on by itself');
  return Number(rows[0].id);
}

async function closeRun(client, runId, { status, counts, error = null, ms }) {
  await client.execute({
    sql: "UPDATE autofill_runs SET status = ?, counts = ?, error = ?, ms = ?, finished_at = datetime('now') WHERE id = ?",
    args: [status, JSON.stringify(counts), error ? String(error).slice(0, 500) : null, ms, runId],
  });
}

function noteFor(item, byName) {
  const how = HOW[item.method] || 'RAMS matching';
  const who = byName ? `, approved by ${byName}` : '';
  const what = item.kind === 'differs' ? ` — replaces "${item.expected}"` : '';
  return `RAMS: Tally ${item.company || ''} matched by ${how}${who}${what}`.replace(/\s+/g, ' ').slice(0, 200);
}

function payloadOf(item, byName) {
  return {
    target: TARGETS[item.target_kind].target,
    po_id: item.po_id,
    value: item.value,
    date: item.date,
    expected: item.expected ?? null,
    note: noteFor(item, byName),
  };
}

// ROMS holds the value now (written, or already so): bring RAMS's copy of ROMS
// and the match result in step at once, and close the item.
function resolvedStmts(item) {
  const mirror = item.target_kind === 'po'
    ? { sql: 'UPDATE roms_pos SET bill_no = ?, bill_date = ? WHERE po_id = ?', args: [item.value, item.date, item.po_id] }
    : { sql: 'UPDATE roms_rtv SET cn_number = ?, cn_date = ? WHERE id = ?', args: [item.value, item.date, Number(item.target_id)] };
  return [
    mirror,
    {
      sql: `UPDATE match_results SET fill = json_set(fill, '$.current', ?, '$.current_date', ?, '$.kind', 'same')
             WHERE target_kind = ? AND target_id = ? AND fill IS NOT NULL`,
      args: [item.value, item.date, item.target_kind, item.target_id],
    },
    { sql: 'DELETE FROM autofill_items WHERE target_kind = ? AND target_id = ?', args: [item.target_kind, item.target_id] },
  ];
}

function eventStmt(item, result, reason, runId, userId) {
  return {
    sql: `INSERT INTO autofill_events (run_id, target_kind, target_id, po_id, field, kind, old_value, new_value, old_date, new_date, result, reason, by_user)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [runId, item.target_kind, item.target_id, item.po_id, item.field, item.kind, item.expected ?? null, item.value,
      item.expected_date ?? null, item.date, result, reason ? String(reason).slice(0, 500) : null, userId],
  };
}

// One ROMS answer -> the statements that record it, and what it counts as.
function answerStmts(item, answer, { dryRun, runId, userId }) {
  const { result, reason } = answer;
  if (result === 'applied' || result === 'skipped') {
    return {
      count: result === 'applied' ? 'written' : 'already',
      stmts: [...(dryRun ? [] : [eventStmt(item, result, reason, runId, userId)]), ...resolvedStmts(item)],
    };
  }
  if (result === 'would_apply') {
    return {
      count: 'checked',
      stmts: [{
        sql: `UPDATE autofill_items SET state = 'checked', reason = NULL, dry = 1, tried_at = datetime('now'), updated_at = datetime('now')
               WHERE target_kind = ? AND target_id = ?`,
        args: [item.target_kind, item.target_id],
      }],
    };
  }
  // rejected, or anything ROMS did not say it did
  const why = reason || `ROMS answered "${result || 'nothing'}"`;
  return {
    count: 'refused',
    stmts: [
      ...(dryRun ? [] : [eventStmt(item, 'rejected', why, runId, userId)]),
      {
        sql: `UPDATE autofill_items SET state = 'refused', reason = ?, dry = ?, tries = tries + 1, tried_at = datetime('now'),
                     updated_at = datetime('now')
               WHERE target_kind = ? AND target_id = ?`,
        args: [String(why).slice(0, 500), dryRun ? 1 : 0, item.target_kind, item.target_id],
      },
    ],
  };
}

function clientFor({ roms, romsSettings }) {
  if (roms) return roms;
  const settings = romsSettings || readRomsSettings();
  if (!settings.configured) return null;
  return createRomsClient(settings);
}

const NOT_CONNECTED = 'ROMS isn\'t connected — set ROMS_API_URL and ROMS_INTEGRATION_TOKEN';
const zero = () => ({
  written: 0, already: 0, refused: 0, checked: 0,
});

// One round: writes first, then dry runs, BATCH items per ROMS call, until the
// work is done or the time box is up.
async function sendAutofill(client, {
  roms, romsSettings, trigger = 'connector', userId = null, deadlineMs = DEADLINE_MS, batch = BATCH, now = Date.now,
} = {}) {
  const s = await loadSettings(client);
  const { write, check } = await openWork(client, s);
  const total = write.length + check.length;
  if (!total) return { ok: true, counts: zero(), remaining: 0, more: false };
  const reader = clientFor({ roms, romsSettings });
  if (!reader) return { ok: false, error: NOT_CONNECTED, counts: zero(), remaining: total, more: false };

  const runId = await takeLock(client, trigger, userId);
  const started = now();
  const counts = zero();
  const chunks = [];
  for (let i = 0; i < write.length; i += batch) chunks.push({ dryRun: false, items: write.slice(i, i + batch) });
  for (let i = 0; i < check.length; i += batch) chunks.push({ dryRun: true, items: check.slice(i, i + batch) });
  let done = 0;
  let slowest = 0;
  try {
    for (const { dryRun, items } of chunks) {
      // Don't start a batch that would likely run past the time box.
      if (done && now() - started + slowest > deadlineMs) break;
      const t0 = now();
      const answer = await reader.autofill(items.map((i) => payloadOf(i, i.approved_by_name)), { dryRun });
      const stmts = [];
      items.forEach((item, idx) => {
        const out = answerStmts(item, answer.results[idx] || {}, { dryRun, runId, userId: item.approved_by ?? null });
        counts[out.count] += 1;
        stmts.push(...out.stmts);
      });
      await writeBatches(client, stmts);
      done += items.length;
      slowest = Math.max(slowest, now() - t0);
    }
  } catch (e) {
    const ms = now() - started;
    const error = e instanceof RomsError ? e.message : `Auto-fill stopped: ${e.message}`;
    await closeRun(client, runId, { status: 'failed', counts, error, ms });
    return {
      ok: false, run_id: runId, error, counts, remaining: total - done, more: false, ms,
    };
  }
  const ms = now() - started;
  await closeRun(client, runId, { status: 'ok', counts, ms });
  return {
    ok: true, run_id: runId, counts, remaining: total - done, more: done < total, ms,
  };
}

// ------------------------------------------------------------ people

async function itemOf(client, kind, id) {
  if (!TARGETS[kind]) throw fail(404, 'Not found');
  const { rows: [item] } = await client.execute({
    sql: `SELECT i.*, c.code AS company, r.method FROM autofill_items i
            LEFT JOIN tally_companies c ON c.id = i.company_id
            LEFT JOIN match_results r ON r.target_kind = i.target_kind AND r.target_id = i.target_id
           WHERE i.target_kind = ? AND i.target_id = ?`,
    args: [kind, String(id)],
  });
  if (!item) throw fail(404, kind === 'po' ? `Nothing to write for PO ${id}` : `Nothing to write for RTV row ${id}`);
  return item;
}

// Approve what is waiting in Ask first: every item of a field, or the listed
// ones. Returns how many.
async function approve(client, { kind, ids = null, userId }) {
  if (!TARGETS[kind]) throw fail(400, 'Say which field: po (Bill No) or rtv (CN No)');
  const list = Array.isArray(ids) ? ids.map(String) : null;
  if (list && !list.length) return 0;
  const { rowsAffected } = await client.execute({
    sql: `UPDATE autofill_items SET state = 'to_write', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
           WHERE target_kind = ? AND state IN ('to_check','checked')
             ${list ? `AND target_id IN (${list.map(() => '?').join(',')})` : ''}`,
    args: [userId, kind, ...(list || [])],
  });
  return rowsAffected;
}

// Try a refused one again: approved by whoever pressed it, so Ask first
// writes it on the next round, and the other modes treat it as new.
async function retry(client, { kind, id, userId }) {
  const item = await itemOf(client, kind, id);
  if (item.state !== 'refused') throw fail(400, 'Only a write ROMS refused can be tried again');
  const s = await loadSettings(client);
  const approved = s[TARGETS[kind].mode] === 'approve';
  await client.execute({
    sql: `UPDATE autofill_items SET state = ?, reason = NULL, dry = 0, approved_by = ?, approved_at = ${approved ? "datetime('now')" : 'NULL'},
                 updated_at = datetime('now')
           WHERE target_kind = ? AND target_id = ?`,
    args: [approved ? 'to_write' : 'to_check', approved ? userId : null, kind, String(id)],
  });
  return { ...item, state: approved ? 'to_write' : 'to_check' };
}

// A person writes Tally's number over a value staff typed that is not a form
// of it -- one row, now, whatever the mode.
async function overwrite(client, {
  kind, id, user, roms, romsSettings,
}) {
  const item = await itemOf(client, kind, id);
  if (item.state !== 'differs') throw fail(400, 'This row has no different value to replace');
  const reader = clientFor({ roms, romsSettings });
  if (!reader) throw fail(503, NOT_CONNECTED);
  const runId = await takeLock(client, 'manual', user.id);
  const started = Date.now();
  const counts = zero();
  try {
    const answer = await reader.autofill([payloadOf(item, user.name)], { dryRun: false });
    const out = answerStmts(item, answer.results[0] || {}, { dryRun: false, runId, userId: user.id });
    counts[out.count] += 1;
    await writeBatches(client, out.stmts);
    await closeRun(client, runId, { status: 'ok', counts, ms: Date.now() - started });
    return { result: out.count, reason: (answer.results[0] || {}).reason || null, item };
  } catch (e) {
    await closeRun(client, runId, { status: 'failed', counts, error: e.message, ms: Date.now() - started });
    if (e instanceof RomsError) throw fail(502, e.message);
    throw e;
  }
}

module.exports = {
  planAutofill, sendAutofill, autofillDue, lastAutofill, approve, retry, overwrite, wanted, actionOf, TARGETS, BATCH, DEADLINE_MS, STALE_MINUTES,
};
